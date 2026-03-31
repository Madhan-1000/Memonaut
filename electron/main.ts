import { app, BrowserWindow, globalShortcut, ipcMain, clipboard, Notification, Tray, Menu, nativeImage } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import fssync from 'node:fs'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Keep a stable userData location so the database persists across runs
const USER_DATA_DIR = path.join(app.getPath('appData'), 'Memonaut')
app.setPath('userData', USER_DATA_DIR)

// Keep userData persistent, but move caches to a writable temp location to avoid permission issues
const CACHE_ROOT = fssync.mkdtempSync(path.join(os.tmpdir(), 'MemonautCache-'))
const getDataDir = () => path.join(app.getPath('userData'), 'data')
const getDbPath = () => path.join(getDataDir(), 'snippets.sqlite')
const getLegacyJsonPath = () => path.join(getDataDir(), 'snippets.json')

app.setPath('cache', CACHE_ROOT)

// Point Chromium caches to writable temp paths and disable disk caches
app.commandLine.appendSwitch('disk-cache-dir', path.join(CACHE_ROOT, 'disk'))
app.commandLine.appendSwitch('media-cache-dir', path.join(CACHE_ROOT, 'media'))
app.commandLine.appendSwitch('gpu-cache-path', path.join(CACHE_ROOT, 'gpu'))
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
app.commandLine.appendSwitch('disk-cache-size', '0')
app.commandLine.appendSwitch('media-cache-size', '0')
app.commandLine.appendSwitch('disable-http-cache')

// The built directory structure
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

type Snippet = { id: string; text: string; source: string; createdAt: number; category: string }
type HotkeyStatus =
  | { state: 'ready'; accelerator?: string }
  | { state: 'unavailable'; reason?: string }
  | { state: 'error'; message?: string }

const DEFAULT_ACCEL = 'CommandOrControl+Shift+Q'
const HOTKEY = process.env.HOTKEY_ACCEL || DEFAULT_ACCEL
let activeHotkey = HOTKEY

let win: BrowserWindow | null
let lastStatus: HotkeyStatus = { state: 'unavailable', reason: 'not registered' }
let db: Database | null = null
let tray: Tray | null = null
let isQuitting = false

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

app.on('second-instance', () => {
  if (win) {
    if (!win.isVisible()) win.show()
    win.focus()
  } else {
    createWindow()
  }
})

app.on('before-quit', () => {
  isQuitting = true
})

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function ensureDataDir() {
  const dataDir = getDataDir()
  await fs.mkdir(dataDir, { recursive: true })
  await fs.mkdir(CACHE_ROOT, { recursive: true })
  await fs.mkdir(path.join(CACHE_ROOT, 'disk'), { recursive: true })
  await fs.mkdir(path.join(CACHE_ROOT, 'media'), { recursive: true })
  await fs.mkdir(path.join(CACHE_ROOT, 'gpu'), { recursive: true })
}

async function migrateLegacyJson(database: Database) {
  const legacyPath = getLegacyJsonPath()
  if (!fssync.existsSync(legacyPath)) return
  try {
    const raw = await fs.readFile(legacyPath, 'utf-8')
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
    await fs.unlink(legacyPath)
    console.log('Migrated legacy snippets.json into SQLite')
  } catch (err) {
    console.error('Migration from JSON failed', err)
  }
}

async function ensureDatabaseReady(): Promise<Database> {
  if (db) return db
  await ensureDataDir()
  const dbPath = getDbPath()
  console.log(`Using snippets DB at ${dbPath}`)
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.prepare(`
    CREATE TABLE IF NOT EXISTS snippets (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('hotkey','manual')),
      category TEXT NOT NULL DEFAULT 'uncategorized'
    )
  `).run()

  // Backfill category column for existing databases
  const hasCategory = db
    .prepare("PRAGMA table_info('snippets')")
    .all()
    .some((row: any) => row.name === 'category')
  if (!hasCategory) {
    db.prepare("ALTER TABLE snippets ADD COLUMN category TEXT NOT NULL DEFAULT 'uncategorized'").run()
    console.log('Added category column to snippets table')
  }

  await migrateLegacyJson(db)
  return db
}

function ensureAutoLaunch() {
  try {
    const settings = app.getLoginItemSettings()
    if (!settings.openAtLogin) {
      app.setLoginItemSettings({ openAtLogin: true })
    }
  } catch (err) {
    console.error('Failed to configure auto-launch', err)
  }
}

async function readSnippets(): Promise<Snippet[]> {
  const database = await ensureDatabaseReady()
  const rows = database
    .prepare("SELECT id, text, createdAt, source, COALESCE(category, 'uncategorized') AS category FROM snippets ORDER BY createdAt DESC")
    .all()
  return rows as Snippet[]
}

function categorizeSnippet(text: string): string {
  const t = text.toLowerCase()
  const rules: Array<{ label: string; match: RegExp }> = [
    { label: 'biology', match: /(cell|dna|protein|genome|enzyme|biolog)/ },
    { label: 'chemistry', match: /(molecul|compound|reaction|chem|bond|stoichiometr)/ },
    { label: 'physics', match: /(quantum|force|energy|momentum|relativity|thermo)/ },
    { label: 'math', match: /(theorem|lemma|proof|integral|derivative|matrix|vector|calculus|algebra|geometry)/ },
    { label: 'statistics', match: /(probabilit|statistic|regression|bayes|variance|mean|median|distribution)/ },
    { label: 'cs-algorithms', match: /(algorithm|complexity|big o|graph|tree|dp|dynamic programming)/ },
    { label: 'code', match: /(function|class|import|export|console\.log|error|stack trace|api|http|typescript|javascript|python|java|c\+\+|c#|go|rust)/ },
    { label: 'ai-ml', match: /(model|neural|transformer|llm|prompt|embedding|ml|machine learning|dataset|training|inference)/ },
    { label: 'data-science', match: /(pandas|numpy|dataframe|analysis|visualization|plot|chart|eda)/ },
    { label: 'database-sql', match: /(sql|query|select|join|index|postgres|mysql|sqlite|mongodb)/ },
    { label: 'devops', match: /(docker|kubernetes|k8s|deployment|ci\/cd|pipeline|server|cloud|aws|azure|gcp|ansible|terraform)/ },
    { label: 'security', match: /(vuln|cve|encryption|auth|oauth|token|xss|csrf|jwt|pentest|security)/ },
    { label: 'networking', match: /(tcp|udp|ip|dns|latency|bandwidth|socket|http\/2|http\/3|tls)/ },
    { label: 'web', match: /(react|vue|angular|svelte|css|html|frontend|ui)/ },
    { label: 'mobile', match: /(android|ios|swift|kotlin|react native|flutter)/ },
    { label: 'cloud', match: /(s3|ec2|lambda|cloud run|app engine|cloudfront|cdn|iam)/ },
    { label: 'task', match: /(todo|to-do|task|action item|follow up|due|deadline|reminder|next step)/ },
    { label: 'meeting', match: /(meeting|minutes|notes|attendees|agenda|follow-up)/ },
    { label: 'product', match: /(roadmap|feature|spec|requirement|acceptance criteria|user story)/ },
    { label: 'design', match: /(ux|ui|wireframe|figma|mockup|layout|contrast|typograph)/ },
    { label: 'writing', match: /(draft|outline|headline|intro|summary|blog|essay|copy|content)/ },
    { label: 'research', match: /(citation|doi|paper|study|experiment|dataset)/ },
    { label: 'reference', match: /(reference|source:|url|link|bookmark)/ },
    { label: 'business', match: /(revenue|pricing|market|sales|kpi|stakeholder|okr|roi|budget)/ },
    { label: 'marketing', match: /(campaign|seo|sem|conversion|landing page|ad copy|funnel)/ },
    { label: 'sales', match: /(lead|prospect|deal|pipeline|crm|close|quote)/ },
    { label: 'finance', match: /(equity|bond|yield|interest rate|inflation|gdp|cash flow|valuation|p&l|balance sheet)/ },
    { label: 'economics', match: /(macro|microeconomics|supply|demand|elasticity|gdp|cpi)/ },
    { label: 'legal-policy', match: /(contract|nda|gdpr|hipaa|policy|compliance|licensing|privacy)/ },
    { label: 'health-medicine', match: /(medication|symptom|diagnosis|therapy|disease|medical|clinic|prescription)/ },
    { label: 'fitness', match: /(fitness|calorie|diet|workout|exercise|set|rep|run|yoga)/ },
    { label: 'education-studies', match: /(lecture|class notes|course|study guide|syllabus|exam|quiz|homework|assignment)/ },
    { label: 'motivation', match: /(motivation|inspiration|quote|affirmation|mindset|goal)/ },
    { label: 'personal', match: /(shopping list|grocery|travel|booking|reservation|birthday|anniversary|gift)/ },
    { label: 'productivity', match: /(workflow|routine|habit|time block|pomodoro|focus)/ },
    { label: 'creative', match: /(poem|story|plot|character|lyrics|melody|riff|art|sketch)/ },
    { label: 'cooking', match: /(recipe|ingredient|oven|bake|cook|grill|boil|serves)/ },
    { label: 'news', match: /(breaking|headline|news|report|journalism)/ },
    { label: 'sports', match: /(game|match|tournament|league|score|team|player|coach)/ },
    { label: 'philosophy', match: /(ethics|epistemology|ontology|consciousness|kant|nietzsche|plato)/ },
    { label: 'history', match: /(ancient|medieval|revolution|war|empire|civilization|dynasty|historical)/ },
    { label: 'language', match: /(grammar|vocabulary|translation|linguistics|etymology|syntax|dialect)/ },
    { label: 'env-science', match: /(climate|carbon|ecosystem|biodiversity|renewable|sustainability|emission)/ },
    { label: 'crypto-web3', match: /(blockchain|bitcoin|ethereum|defi|nft|wallet|smart contract|solidity)/ },
    { label: 'mental-health', match: /(anxiety|depression|therapy|mindfulness|burnout|stress|mental health)/ },
    { label: 'social-media', match: /(twitter|linkedin|instagram|viral|engagement|followers|content creator)/ },
    { label: 'startup', match: /(founder|fundraising|vc|pitch|mvp|traction|churn|arr|mrr|seed|series)/ },
  ]

  for (const rule of rules) {
    if (rule.match.test(t)) return rule.label
  }
  return 'uncategorized'
}

async function appendSnippet(text: string, source = 'hotkey'): Promise<Snippet> {
  const database = await ensureDatabaseReady()
  const createdAt = Date.now()
  const category = categorizeSnippet(text)
  const snippet: Snippet = {
    id: randomUUID(),
    text,
    source,
    createdAt,
    category,
  }

  database
    .prepare('INSERT INTO snippets (id, text, createdAt, source, category) VALUES (?, ?, ?, ?, ?)')
    .run(snippet.id, snippet.text, snippet.createdAt, snippet.source, snippet.category)

  notifySnippet(snippet)
  broadcastSnippet(snippet)
  return snippet
}

function showWindow() {
  if (!win) {
    createWindow()
    return
  }
  if (!win.isVisible()) win.show()
  if (win.isMinimized()) win.restore()
  win.focus()
}

function notifySnippet(snippet: Snippet) {
  if (!Notification.isSupported()) return
  const body = snippet.text.length > 120 ? `${snippet.text.slice(0, 117)}...` : snippet.text || 'Empty snippet'
  const notification = new Notification({ title: 'Snippet saved', body })
  notification.on('click', () => {
    showWindow()
  })
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
  console.log(`Registering hotkey: ${HOTKEY}`)
  const handler = async () => {
    try {
      const snippet = await captureCopyFlow()
      if (snippet) {
        broadcastStatus({ state: 'ready', accelerator: activeHotkey })
      }
    } catch (err) {
      console.error('Hotkey handler failed', err)
      broadcastStatus({ state: 'error', message: 'hotkey handler failed' })
    }
  }

  try {
    globalShortcut.register(HOTKEY, handler)

    if (globalShortcut.isRegistered(HOTKEY)) {
      activeHotkey = HOTKEY
      broadcastStatus({ state: 'ready', accelerator: HOTKEY })
      return
    }

    console.warn(`Hotkey registration reported not registered for ${HOTKEY}`)
  } catch (err) {
    console.error(`Hotkey registration failed for ${HOTKEY}`, err)
    broadcastStatus({ state: 'error', message: 'hotkey registration failed' })
    return
  }

  broadcastStatus({
    state: 'unavailable',
    reason: `registration failed for ${HOTKEY} (key in use or blocked by OS)`,
  })
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
    icon: path.join(process.env.APP_ROOT, 'assets', 'memonaut.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    win?.hide()
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

function createTray() {
  const iconPath = path.join(process.env.APP_ROOT, 'assets', 'memonaut.png')
  const image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) {
    console.warn(`Tray icon missing at ${iconPath}, using empty icon`)
  }
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show',
      click: () => {
        showWindow()
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])
  tray.setToolTip('Memonaut')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    if (!win) {
      createWindow()
    } else {
      win.isVisible() ? win.hide() : win.show()
    }
  })
}

app.on('window-all-closed', (event) => {
  if (isQuitting) return
  event.preventDefault()
  win = null
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  } else {
    win?.show()
  }
})

app.whenReady().then(async () => {
  await ensureDatabaseReady()
  setupIpc()
  createWindow()
  createTray()
  ensureAutoLaunch()
  registerHotkey()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  if (db) {
    db.close()
    db = null
  }
})
