/**
 * "asahi" is the original setup (thread-capped aliases, CPU server + Vulkan
 * server, SearXNG, benchmarks). "desktop" is the packaged Windows app: one
 * Ollama on an NVIDIA GPU, raw model refs, web search without a container.
 *
 * NEXT_PUBLIC_ so the same value is inlined into client and server bundles at
 * build time; the Electron build sets it to "desktop".
 */
export type AppProfile = "asahi" | "desktop";

export const PROFILE: AppProfile = process.env.NEXT_PUBLIC_APP_PROFILE === "desktop" ? "desktop" : "asahi";
export const IS_DESKTOP = PROFILE === "desktop";
