import "server-only";
import { Readability } from "@mozilla/readability";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { pipeline, type Readable } from "node:stream";
import zlib from "node:zlib";
import { parseHTML } from "linkedom";
import { PAGE_TEXT_LIMIT, type ToolResult } from "./tools";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
/** Socket idle timeout, plus one overall deadline so a trickling page can't hang a reply. */
const TIMEOUT_MS = 10_000;
const DEADLINE_MS = 15_000;

// fetch_url is driven by model output, so it must never reach this machine or
// the LAN (Ollama, SearXNG, router admin pages...). Every address a hostname
// resolves to is checked inside the socket's own DNS lookup, so a rebinding
// DNS answer can't slip a private IP in between "check" and "connect".
const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
  // IPv4-compatible, NAT64 and 6to4 forms can embed 127.0.0.1 or a LAN address.
  ["::", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["2002::", 16],
] as const) blocked.addSubnet(net, prefix, "ipv6");
// No ::ffff:0:0/96 rule: BlockList already checks IPv4-mapped IPv6 addresses
// (::ffff:127.0.0.1) against the IPv4 rules, and that rule would match every
// IPv4 address, public ones included.

function isBlocked(address: string): boolean {
  const family = isIP(address);
  return family === 0 || blocked.check(address, family === 6 ? "ipv6" : "ipv4");
}

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => isBlocked(a.address));
    if (bad || list.length === 0) {
      return callback(Object.assign(new Error(`Refusing to fetch private address ${bad?.address ?? hostname}`), { code: "EBLOCKED" }), "", 0);
    }
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

interface Raw {
  url: string;
  contentType: string;
  body: Buffer;
  truncated: boolean;
}

/** Decoded body. pipeline() forwards errors and teardown from `res` to zlib, so a dropped connection rejects instead of hanging. */
function decode(res: http.IncomingMessage): Readable {
  const enc = (res.headers["content-encoding"] ?? "").toLowerCase();
  const inflate =
    enc === "gzip" ? zlib.createGunzip() : enc === "deflate" ? zlib.createInflate() : enc === "br" ? zlib.createBrotliDecompress() : null;
  if (!inflate) return res;
  return pipeline(res, inflate, () => {});
}

function get(target: URL, signal: AbortSignal, redirects = 0): Promise<Raw> {
  return new Promise((resolve, reject) => {
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return reject(new Error("Only http(s) URLs can be fetched"));
    }
    // A literal IP never goes through DNS, so check it here as well.
    const host = target.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && isBlocked(host)) return reject(new Error(`Refusing to fetch private address ${host}`));

    const mod = target.protocol === "https:" ? https : http;
    const req = mod.get(
      target,
      {
        lookup: guardedLookup,
        signal,
        timeout: TIMEOUT_MS,
        headers: {
          "User-Agent": "Mozilla/5.0 (local-chat fetch_url)",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
          "Accept-Encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirects >= MAX_REDIRECTS) return reject(new Error("Too many redirects"));
          // Each hop goes back through get(), so it is re-validated.
          return get(new URL(res.headers.location, target), signal, redirects + 1).then(resolve, reject);
        }
        if (status >= 400) {
          res.resume();
          return reject(new Error(`HTTP ${status}`));
        }
        const contentType = String(res.headers["content-type"] ?? "");
        if (!/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
          res.resume();
          return reject(new Error(`Unsupported content type: ${contentType || "unknown"}`));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        const stream = decode(res);
        stream.on("data", (c: Buffer) => {
          if (truncated) return;
          size += c.length;
          if (size > MAX_BYTES) {
            truncated = true;
            chunks.push(c.subarray(0, c.length - (size - MAX_BYTES)));
            stream.destroy();
            res.destroy();
            return resolve({ url: target.href, contentType, body: Buffer.concat(chunks), truncated });
          }
          chunks.push(c);
        });
        stream.on("end", () => resolve({ url: target.href, contentType, body: Buffer.concat(chunks), truncated }));
        stream.on("error", (e) => (truncated ? undefined : reject(e)));
      },
    );
    req.on("timeout", () => req.destroy(new Error("Timed out after 10 s")));
    req.on("error", reject);
  });
}

function extract(raw: Raw): { title: string; text: string } {
  const source = raw.body.toString("utf8");
  if (!/html/i.test(raw.contentType)) return { title: raw.url, text: source };
  const { document } = parseHTML(source);
  const article = new Readability(document as unknown as Document).parse();
  const text = article?.textContent?.trim() || document.body?.textContent || "";
  return { title: article?.title?.trim() || document.title || raw.url, text };
}

export async function fetchPage(url: string, signal: AbortSignal, limit = PAGE_TEXT_LIMIT): Promise<ToolResult> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { content: `Error: "${url}" is not a valid URL`, error: "Invalid URL" };
  }
  const raw = await get(target, AbortSignal.any([signal, AbortSignal.timeout(DEADLINE_MS)]));
  const { title, text } = extract(raw);
  const clean = text.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  const truncated = raw.truncated || clean.length > limit;
  const body = clean.slice(0, limit);
  return {
    content: `Page: ${title}\nURL: ${raw.url}\n\n${body}${truncated ? "\n\n[truncated]" : ""}`,
    page: { title, url: raw.url, chars: body.length, truncated },
  };
}
