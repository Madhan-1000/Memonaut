/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  ipcRenderer: import('electron').IpcRenderer

  /** API exposed by preload for snippet operations */
  snippetApi: {
    /** Load all saved snippets from disk */
    load: () => Promise<Snippet[]>;
    /** Add a new snippet with optional source label */
    add: (text: string, source?: string) => Promise<Snippet>;
    /** (Optional) trigger synthetic copy+save flow from renderer */
    captureCopy?: () => Promise<Snippet | null>;
    /** Notify when a hotkey-captured snippet is available */
    onHotkeySnippet: (cb: (snippet: Snippet) => void) => () => void;
    /** Notify when hotkey availability/status changes */
    onHotkeyStatus: (cb: (status: HotkeyStatus) => void) => () => void;
    /** Inform main/preload that renderer is ready to receive events */
    ready: () => void;
    /** Request current hotkey status */
    status: () => Promise<HotkeyStatus>;
  }
}

interface Snippet {
  id: string
  text: string
  source: string
  createdAt: number
}

type HotkeyStatus =
  | { state: 'ready' }
  | { state: 'unavailable'; reason?: string }
  | { state: 'error'; message?: string }
