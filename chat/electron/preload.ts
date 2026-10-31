import { contextBridge, ipcRenderer } from "electron";
import type { UpdateState, UpdatesBridge } from "../lib/updates";

// A closed set of calls: the page never gets ipcRenderer itself, and none of the calls take arguments from it.
const updates: UpdatesBridge = {
  get: () => ipcRenderer.invoke("update:get"),
  check: () => ipcRenderer.invoke("update:check"),
  download: () => ipcRenderer.invoke("update:download"),
  install: () => ipcRenderer.invoke("update:install"),
  onState: (cb) => {
    const listener = (_e: unknown, state: UpdateState) => cb(state);
    ipcRenderer.on("update:state", listener);
    return () => ipcRenderer.removeListener("update:state", listener);
  },
};

contextBridge.exposeInMainWorld("updates", updates);
