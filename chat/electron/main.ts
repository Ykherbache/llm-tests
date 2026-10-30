import { app, BrowserWindow, dialog, shell, utilityProcess, type UtilityProcess } from "electron";
import { autoUpdater } from "electron-updater";
import fs from "node:fs";
import path from "node:path";
import { unloadAll } from "../lib/unload";

// Fixed port: IndexedDB is per origin, so a random port would lose the chat history at every launch.
const PORT = 43117;
const ORIGIN = `http://127.0.0.1:${PORT}`;

let server: UtilityProcess | null = null;
let win: BrowserWindow | null = null;

/** Packaged: electron-builder copies .next/standalone to resources/server. Dev: run from the build output. */
function serverEntry(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "server", "server.js")
    : path.join(__dirname, "..", "..", ".next", "standalone", "server.js");
}

function startServer(logFile: string): void {
  const entry = serverEntry();
  const log = fs.createWriteStream(logFile, { flags: "a" });
  server = utilityProcess.fork(entry, [], {
    cwd: path.dirname(entry),
    stdio: "pipe",
    env: {
      ...process.env,
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
      APP_VERSION: app.getVersion(),
      APP_LOG_FILE: logFile,
    },
  });
  server.stdout?.pipe(log);
  server.stderr?.pipe(log);
  server.on("exit", (code) => {
    log.write(`[main] server exited with code ${code}\n`);
    if (!app.isReady() || win === null) return;
    void dialog.showMessageBox({ type: "error", message: "The chat server stopped.", detail: `See ${logFile}` }).then(() => app.quit());
  });
}

async function waitForServer(timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${ORIGIN}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return true;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 380,
    minHeight: 500,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // Links in answers open in the real browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(ORIGIN)) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });
  win.on("closed", () => {
    win = null;
  });
  void win.loadURL(ORIGIN);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win?.isMinimized()) win.restore();
    win?.focus();
  });

  void app.whenReady().then(async () => {
    const logFile = path.join(app.getPath("logs"), "server.log");
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    startServer(logFile);
    if (!(await waitForServer())) {
      await dialog.showMessageBox({
        type: "error",
        message: "The chat server did not start.",
        detail: `Port ${PORT} may be in use by another program. Log: ${logFile}`,
      });
      app.quit();
      return;
    }
    createWindow();
    if (app.isPackaged) void autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  });

  app.on("window-all-closed", () => app.quit());
  // Free the video memory before exiting: Ollama would keep the model resident for 15 more minutes.
  // Done here rather than through the Next server so it works even if that server already died.
  let quitting = false;
  app.on("before-quit", (e) => {
    if (quitting) {
      server?.kill();
      return;
    }
    e.preventDefault();
    quitting = true;
    const base = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
    void Promise.race([unloadAll(base), new Promise((r) => setTimeout(r, 4000))]).finally(() => app.quit());
  });
}
