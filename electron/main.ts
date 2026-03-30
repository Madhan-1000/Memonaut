import { app, BrowserWindow, globalShortcut, ipcMain, clipboard, Notification } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import fssync from 'node:fs'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Keep app data in a dedicated folder
app.setPath('userData', path.join(app.getPath('appData'), 'Memonaut'))
app.setPath('cache', path.join(app.getPath('userData'), 'Cache'))

// The built directory structure
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

type Snippet = { id: string; text: string; source: string; createdAt: number }
type HotkeyStatus =
  | { state: 'ready' }
  | { state: 'unavailable'; reason?: string }
  | { state: 'error'; message?: string }

const DATA_DIR = path.join(app.getPath('userData'), 'data')
const SNIPPETS_PATH = path.join(DATA_DIR, 'snippets.json')
const DB_PATH = path.join(DATA_DIR, 'snippets.sqlite')
const HOTKEY_ACCEL = process.platform === 'darwin' ? 'Command+Shift+Q' : 'Control+Shift+Q'

let win: BrowserWindow | null
let lastStatus: HotkeyStatus = { state: 'unavailable', reason: 'not registered' }
let db: Database.Database | null = null

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true })
}

async function migrateLegacyJson(database: Database.Database) {
  if (!fssync.existsSync(SNIPPETS_PATH)) return
  try {
    const raw = await fs.readFile(SNIPPETS_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return

    const insert = database.prepare(
      'INSERT OR IGNORE INTO snippets (id, text, createdAt, source) VALUES (@id, @text, @createdAt, @source)'
    )
    const tx = database.transaction((rows: any[]) => {
      for (const row of rows) {
        if (!row.text) continue
        insert.run({
          id: row.id || randomUUID(),
          text: String(row.text),
          createdAt: row.createdAt ? Number(new Date(row.createdAt)) : Date.now(),
          source: row.source === 'manual' ? 'manual' : 'hotkey',
        })
      }
    })
    tx(parsed)
    await fs.unlink(SNIPPETS_PATH)
    console.log('Migrated legacy snippets.json into SQLite')
  } catch (err) {
    console.error('Migration from JSON failed', err)
  }
}

async function ensureDatabaseReady(): Promise<Database.Database> {
  if (db) return db
  await ensureDataDir()
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.prepare(`
    CREATE TABLE IF NOT EXISTS snippets (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('hotkey','manual'))
    )
  `).run()

  await migrateLegacyJson(db)
  return db
}

async function readSnippets(): Promise<Snippet[]> {
  const database = await ensureDatabaseReady()
  const rows = database.prepare('SELECT id, text, createdAt, source FROM snippets ORDER BY createdAt DESC').all()
  return rows as Snippet[]
}

async function appendSnippet(text: string, source = 'hotkey'): Promise<Snippet> {
  const database = await ensureDatabaseReady()
  const createdAt = Date.now()
  const snippet: Snippet = {
    id: randomUUID(),
    text,
    source,
    createdAt,
  }

  database
    .prepare('INSERT INTO snippets (id, text, createdAt, source) VALUES (?, ?, ?, ?)')
    .run(snippet.id, snippet.text, snippet.createdAt, snippet.source)

  notifySnippet(snippet)
  broadcastSnippet(snippet)
  return snippet
}

function notifySnippet(snippet: Snippet) {
  if (!Notification.isSupported()) return
  const body = snippet.text.length > 120 ? `${snippet.text.slice(0, 117)}...` : snippet.text || 'Empty snippet'
  const notification = new Notification({ title: 'Snippet saved', body })
  notification.show()
}

function broadcastSnippet(snippet: Snippet) {
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('hotkey:snippet', snippet))
}

function broadcastStatus(status: HotkeyStatus) {
  lastStatus = status
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('hotkey:status', status))
}

async function syntheticCopy(): Promise<boolean> {
  const platform = process.platform
  let command: string
  let args: string[]

  if (platform === 'win32') {
    command = 'powershell'
    args = [
      '-NoProfile',
      '-Command',
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c')",
    ]
  } else if (platform === 'darwin') {
    command = 'osascript'
    args = ['-e', 'tell application "System Events" to keystroke "c" using {command down}']
  } else {
    command = 'xdotool'
    args = ['key', '--clearmodifiers', 'ctrl+c']
  }

  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore' })
    child.on('error', (err) => {
      console.error('synthetic copy failed', err)
      resolve(false)
    })
    child.on('exit', (code) => resolve(code === 0))
  })
}

async function readClipboardText(): Promise<string> {
  const selection = clipboard.readText('selection')
  if (selection && selection.trim().length > 0) return selection
  return clipboard.readText() || ''
}

async function captureCopyFlow(): Promise<Snippet | null> {
  const didCopy = await syntheticCopy()
  if (!didCopy) {
    broadcastStatus({ state: 'error', message: 'synthetic copy failed' })
  }

  await delay(140)
  const text = await readClipboardText()
  if (!text || !text.trim()) {
    console.warn('Hotkey triggered but clipboard was empty')
    return null
  }

  return appendSnippet(text.trim(), 'hotkey')
}

function registerHotkey() {
  try {
    const ok = globalShortcut.register(HOTKEY_ACCEL, async () => {
      try {
        const snippet = await captureCopyFlow()
        if (snippet) {
          broadcastStatus({ state: 'ready' })
        }
      } catch (err) {
        console.error('Hotkey handler failed', err)
        broadcastStatus({ state: 'error', message: 'hotkey handler failed' })
      }
    })

    if (ok) {
      broadcastStatus({ state: 'ready' })
    } else {
      broadcastStatus({ state: 'unavailable', reason: 'registration failed' })
    }
  } catch (err) {
    console.error('Hotkey registration failed', err)
    broadcastStatus({ state: 'error', message: 'registration exception' })
  }
}

function setupIpc() {
  ipcMain.handle('snippets:load', async () => {
    return readSnippets()
  })

  ipcMain.handle('snippets:add', async (_event, payload: { text: string; source?: string }) => {
    return appendSnippet(payload.text, payload.source || 'manual')
  })

  ipcMain.handle('status:last', () => lastStatus)

  ipcMain.handle('capture:copy', async () => {
    return captureCopyFlow()
  })

  ipcMain.on('renderer:ready', (event) => {
    event.sender.send('hotkey:status', lastStatus)
  })

  ipcMain.on('preload:ready', (event) => {
    event.sender.send('hotkey:status', lastStatus)
  })
}

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date()).toLocaleString())
  })

  win.webContents.on('did-fail-load', (_event, code, desc, url) => {
    console.error('Window failed to load', { code, desc, url })
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(async () => {
  await ensureDatabaseReady()
  setupIpc()
  createWindow()
  registerHotkey()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  if (db) {
    db.close()
    db = null
  }
})
