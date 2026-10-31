/** Shared by the Electron main process, the preload bridge and the renderer. Types only. */
export type UpdateStatus = "idle" | "available" | "downloading" | "ready" | "error";

export interface UpdateState {
  status: UpdateStatus;
  /** Version installed right now. */
  current: string;
  /** Version on offer (available / downloading / ready / error while downloading). */
  version: string | null;
  /** Release notes as plain text, when the release has any. */
  notes: string | null;
  percent: number;
  error: string | null;
  /** Set when the user asked for a check and nothing newer exists. */
  upToDate: boolean;
}

export interface UpdatesBridge {
  get(): Promise<UpdateState>;
  check(): Promise<void>;
  download(): Promise<void>;
  install(): Promise<void>;
  onState(cb: (state: UpdateState) => void): () => void;
}

declare global {
  interface Window {
    /** Only defined inside the Electron app (see electron/preload.ts). */
    updates?: UpdatesBridge;
  }
}
