/**
 * Incremental NDJSON (newline-delimited JSON) parser.
 *
 * Ollama streams one JSON object per line, but the network does not respect
 * line boundaries: a single read() can return half a line, several lines, or
 * a line split in the middle of a multi-byte UTF-8 character. So:
 *
 *   1. Bytes are decoded with a streaming TextDecoder ({ stream: true }), which
 *      holds back an incomplete UTF-8 sequence until the next chunk arrives.
 *   2. Decoded text is appended to `buffer`, and we cut it on "\n".
 *   3. Every piece except the last is a complete line -> parse it.
 *      The last piece is either "" (chunk ended exactly on a newline) or a
 *      partial line, so it stays in `buffer` for the next push().
 *   4. Blank lines (and stray "\r" from CRLF) are skipped.
 *   5. When the stream ends, flush() parses whatever is left, because the
 *      final object is not guaranteed to be followed by a newline.
 */
export class NdjsonParser<T = unknown> {
  private buffer = "";
  private decoder = new TextDecoder();

  /** Feed raw bytes; returns every object completed by this chunk. */
  push(bytes: Uint8Array): T[] {
    this.buffer += this.decoder.decode(bytes, { stream: true });
    const lines = this.buffer.split("\n");
    // Step 3: the tail is incomplete (or empty) - keep it for later.
    this.buffer = lines.pop() ?? "";
    return this.parseLines(lines);
  }

  /** Call once at end of stream to emit a final line without "\n". */
  flush(): T[] {
    // Flushing the decoder emits any bytes it was still holding back.
    this.buffer += this.decoder.decode();
    const rest = this.buffer;
    this.buffer = "";
    return this.parseLines([rest]);
  }

  private parseLines(lines: string[]): T[] {
    const out: T[] = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (line === "") continue;
      try {
        out.push(JSON.parse(line) as T);
      } catch {
        throw new Error(`Malformed line in model stream: ${line.slice(0, 120)}`);
      }
    }
    return out;
  }
}

/** Async iterator over the JSON objects of an NDJSON byte stream. */
export async function* readNdjson<T>(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<T> {
  const parser = new NdjsonParser<T>();
  const reader = body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) yield* parser.push(value);
    }
    yield* parser.flush();
  } finally {
    // Runs on normal end, on error, and when the consumer stops early
    // (abort / break); cancel() is a no-op on an already-closed stream.
    reader.cancel().catch(() => {});
  }
}
