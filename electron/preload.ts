import { ipcRenderer, contextBridge } from 'electron'

function subscribe<T>(channel: string, cb: (payload: T) => void) {
  const handler = (_event: unknown, payload: T) => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

const snippetApi: Window['snippetApi'] = {
  load: () => ipcRenderer.invoke('snippets:load'),
  add: (text: string, source = 'manual') => ipcRenderer.invoke('snippets:add', { text, source }),
  captureCopy: () => ipcRenderer.invoke('capture:copy'),
  onHotkeySnippet: (cb) => subscribe('hotkey:snippet', cb),
  onHotkeyStatus: (cb) => subscribe('hotkey:status', cb),
  ready: () => {
    ipcRenderer.send('renderer:ready')
  },
  status: () => ipcRenderer.invoke('status:last'),
}

contextBridge.exposeInMainWorld('snippetApi', snippetApi)

// Legacy passthrough (optional)
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...rest) => listener(event, ...rest))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
})

// Inform main process that preload is ready to receive status updates
ipcRenderer.send('preload:ready')
