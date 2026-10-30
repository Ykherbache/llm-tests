// The standalone server serves /_next/static from its own .next/static, which `next build` does not fill.
import { cpSync } from "node:fs";

cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
