import { useEffect, useMemo, useState } from 'react'
import './App.css'

type Snippet = Window['snippetApi'] extends { load: () => Promise<infer S> } ? S extends Array<infer T> ? T : never : never
type HotkeyStatus = Parameters<Window['snippetApi']['onHotkeyStatus']>[0] extends (arg: infer S) => void ? S : never

const formatTime = (value: string | number) => new Date(value).toLocaleString()

function App() {
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [status, setStatus] = useState<HotkeyStatus>({ state: 'unavailable', reason: 'starting' })
  const [text, setText] = useState('')
  const [source, setSource] = useState('manual')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const upsertSnippet = (incoming: Snippet) => {
    setSnippets((prev) => [incoming, ...prev.filter((s) => s.id !== incoming.id)])
  }

  useEffect(() => {
    let unsubSnippet: (() => void) | undefined
    let unsubStatus: (() => void) | undefined

    async function init() {
      try {
        setLoading(true)
        const [loaded, lastStatus] = await Promise.all([
          window.snippetApi.load(),
          window.snippetApi.status(),
        ])
        // Deduplicate in case of stale duplicates on disk
        const seen = new Set<string>()
        const unique = loaded.filter((s) => {
          if (seen.has(s.id)) return false
          seen.add(s.id)
          return true
        })
        setSnippets(unique)
        setStatus(lastStatus)
      } catch (err) {
        console.error(err)
        setError('Failed to load snippets')
      } finally {
        setLoading(false)
      }

      window.snippetApi.ready()
      unsubSnippet = window.snippetApi.onHotkeySnippet((snippet) => {
        upsertSnippet(snippet)
      })
      unsubStatus = window.snippetApi.onHotkeyStatus((hotkeyStatus) => {
        setStatus(hotkeyStatus)
      })
    }

    init()

    return () => {
      unsubSnippet?.()
      unsubStatus?.()
    }
  }, [])

  const statusText = useMemo(() => {
    if (status.state === 'ready') return 'Hotkey ready (Ctrl/Cmd+Shift+Q)'
    if (status.state === 'unavailable') return `Hotkey unavailable${status.reason ? `: ${status.reason}` : ''}`
    return `Hotkey error${status.message ? `: ${status.message}` : ''}`
  }, [status])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setLoading(true)
    setError(null)
    try {
      const snippet = await window.snippetApi.add(text.trim(), source || 'manual')
      upsertSnippet(snippet)
      setText('')
    } catch (err) {
      console.error(err)
      setError('Failed to add snippet')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app-shell">
      <header>
        <div>
          <p className="eyebrow">Memonaut</p>
          <h1>Snippet capture</h1>
          <p className="muted">Hotkey: Ctrl/Cmd + Shift + Q · Stored locally in snippets.sqlite</p>
        </div>
        <div className={`status pill ${status.state}`}>{statusText}</div>
      </header>

      <main>
        <section className="card form-card">
          <h2>Add snippet manually</h2>
          <form onSubmit={handleAdd} className="form">
            <label className="field">
              <span>Text</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste or type a snippet"
                rows={4}
              />
            </label>
            <label className="field">
              <span>Source</span>
              <input value={source} onChange={(e) => setSource(e.target.value)} />
            </label>
            <button type="submit" disabled={loading || !text.trim()}>
              {loading ? 'Working…' : 'Save snippet'}
            </button>
          </form>
          {error && <p className="error">{error}</p>}
        </section>

        <section className="card list-card">
          <div className="list-head">
            <h2>Snippets</h2>
            <span className="muted">{snippets.length} saved</span>
          </div>
          {loading && snippets.length === 0 ? (
            <p className="muted">Loading…</p>
          ) : snippets.length === 0 ? (
            <p className="muted">No snippets yet. Use the hotkey or the form to add one.</p>
          ) : (
            <ul className="snippet-list">
              {snippets.map((snippet) => (
                <li key={snippet.id} className="snippet">
                  <div className="snippet-meta">
                    <span className="pill badge">{snippet.source || 'unknown'}</span>
                    <span className="muted">{formatTime(snippet.createdAt)}</span>
                  </div>
                  <p className="snippet-text">{snippet.text}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}

export default App
