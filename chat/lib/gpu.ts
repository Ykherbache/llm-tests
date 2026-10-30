import "server-only";
import { execFile } from "node:child_process";

export interface GpuInfo {
  name: string;
  vramBytes: number;
}

let cached: Promise<GpuInfo | null> | null = null;

/**
 * The NVIDIA card with the most video memory, from `nvidia-smi` (installed with the
 * driver). null when there is no NVIDIA driver. Fixed arguments, no request input; cached
 * for the life of the server since the card does not change.
 */
export function detectGpu(): Promise<GpuInfo | null> {
  cached ??= new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
      { timeout: 3000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null);
        const cards = stdout
          .trim()
          .split("\n")
          .flatMap((line): GpuInfo[] => {
            const [name, mib] = line.split(",").map((s) => s.trim());
            const vramBytes = Number(mib) * 1024 * 1024;
            return name && Number.isFinite(vramBytes) && vramBytes > 0 ? [{ name, vramBytes }] : [];
          });
        resolve(cards.sort((a, b) => b.vramBytes - a.vramBytes)[0] ?? null);
      },
    );
  });
  return cached;
}
