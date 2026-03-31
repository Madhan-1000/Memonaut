import { useEffect, useMemo, useState } from 'react'
import './App.css'

type Snippet = { id: string; text: string; source: string; createdAt: number; category: string }
type HotkeyStatus =
  | { state: 'ready'; accelerator?: string }
  | { state: 'unavailable'; reason?: string }
  | { state: 'error'; message?: string }

const formatTime = (value: string | number) => new Date(value).toLocaleString()

const CATEGORY_RULES: Array<{ label: string; match: RegExp }> = [
  { label: 'biology', match: /(cell|dna|protein|genome|enzyme|biolog)/i },
  { label: 'chemistry', match: /(molecul|compound|reaction|chem|bond|stoichiometr)/i },
  { label: 'physics', match: /(quantum|force|energy|momentum|relativity|thermo)/i },
  { label: 'math', match: /(theorem|lemma|proof|integral|derivative|matrix|vector|calculus|algebra|geometry)/i },
  { label: 'statistics', match: /(probabilit|statistic|regression|bayes|variance|mean|median|distribution)/i },
  { label: 'cs-algorithms', match: /(algorithm|complexity|big o|graph|tree|dp|dynamic programming)/i },
  { label: 'code', match: /(function|class|import|export|console\.log|error|stack trace|api|http|typescript|javascript|python|java|c\+\+|c#|go|rust)/i },
  { label: 'ai-ml', match: /(model|neural|transformer|llm|prompt|embedding|ml|machine learning|dataset|training|inference)/i },
  { label: 'data-science', match: /(pandas|numpy|dataframe|analysis|visualization|plot|chart|eda)/i },
  { label: 'database-sql', match: /(sql|query|select|join|index|postgres|mysql|sqlite|mongodb)/i },
  { label: 'devops', match: /(docker|kubernetes|k8s|deployment|ci\/cd|pipeline|server|cloud|aws|azure|gcp|ansible|terraform)/i },
  { label: 'security', match: /(vuln|cve|encryption|auth|oauth|token|xss|csrf|jwt|pentest|security)/i },
  { label: 'networking', match: /(tcp|udp|ip|dns|latency|bandwidth|socket|http\/2|http\/3|tls)/i },
  { label: 'web', match: /(react|vue|angular|svelte|css|html|frontend|ui)/i },
  { label: 'mobile', match: /(android|ios|swift|kotlin|react native|flutter)/i },
  { label: 'cloud', match: /(s3|ec2|lambda|cloud run|app engine|cloudfront|cdn|iam)/i },
  { label: 'task', match: /(todo|to-do|task|action item|follow up|due|deadline|reminder|next step)/i },
  { label: 'meeting', match: /(meeting|minutes|notes|attendees|agenda|follow-up)/i },
  { label: 'product', match: /(roadmap|feature|spec|requirement|acceptance criteria|user story)/i },
  { label: 'design', match: /(ux|ui|wireframe|figma|mockup|layout|contrast|typograph)/i },
  { label: 'writing', match: /(draft|outline|headline|intro|summary|blog|essay|copy|content)/i },
  { label: 'research', match: /(citation|doi|paper|study|experiment|dataset)/i },
  { label: 'reference', match: /(reference|source:|url|link|bookmark)/i },
  { label: 'business', match: /(revenue|pricing|market|sales|kpi|stakeholder|okr|roi|budget)/i },
  { label: 'marketing', match: /(campaign|seo|sem|conversion|landing page|ad copy|funnel)/i },
  { label: 'sales', match: /(lead|prospect|deal|pipeline|crm|close|quote)/i },
  { label: 'finance', match: /(equity|bond|yield|interest rate|inflation|gdp|cash flow|valuation|p&l|balance sheet)/i },
  { label: 'economics', match: /(macro|microeconomics|supply|demand|elasticity|gdp|cpi)/i },
  { label: 'legal-policy', match: /(contract|nda|gdpr|hipaa|policy|compliance|licensing|privacy)/i },
  { label: 'health-medicine', match: /(medication|symptom|diagnosis|therapy|disease|medical|clinic|prescription)/i },
  { label: 'fitness', match: /(fitness|calorie|diet|workout|exercise|set|rep|run|yoga)/i },
  { label: 'education-studies', match: /(lecture|class notes|course|study guide|syllabus|exam|quiz|homework|assignment)/i },
  { label: 'motivation', match: /(motivation|inspiration|quote|affirmation|mindset|goal)/i },
  { label: 'personal', match: /(shopping list|grocery|travel|booking|reservation|birthday|anniversary|gift)/i },
  { label: 'productivity', match: /(workflow|routine|habit|time block|pomodoro|focus)/i },
  { label: 'creative', match: /(poem|story|plot|character|lyrics|melody|riff|art|sketch)/i },
  { label: 'cooking', match: /(recipe|ingredient|oven|bake|cook|grill|boil|serves)/i },
  { label: 'news', match: /(breaking|headline|news|report|journalism)/i },
  { label: 'sports', match: /(game|match|tournament|league|score|team|player|coach)/i },
  { label: 'philosophy', match: /(ethics|epistemology|ontology|consciousness|kant|nietzsche|plato)/i },
  { label: 'history', match: /(ancient|medieval|revolution|war|empire|civilization|dynasty|historical)/i },
  { label: 'language', match: /(grammar|vocabulary|translation|linguistics|etymology|syntax|dialect)/i },
  { label: 'env-science', match: /(climate|carbon|ecosystem|biodiversity|renewable|sustainability|emission)/i },
  { label: 'crypto-web3', match: /(blockchain|bitcoin|ethereum|defi|nft|wallet|smart contract|solidity)/i },
  { label: 'mental-health', match: /(anxiety|depression|therapy|mindfulness|burnout|stress|mental health)/i },
  { label: 'social-media', match: /(twitter|linkedin|instagram|viral|engagement|followers|content creator)/i },
  { label: 'startup', match: /(founder|fundraising|vc|pitch|mvp|traction|churn|arr|mrr|seed|series)/i },
]

const getTitle = (text: string) => {
  const words = text.trim().split(/\s+/)
  const title = words.slice(0, 4).join(' ')
  if (!title) return 'Untitled snippet'
  return words.length > 4 ? `${title}…` : title
}

const getExcerpt = (text: string, limit = 140) => {
  if (text.length <= limit) return text
  return `${text.slice(0, limit).trim()}…`
}

const findAltCategory = (text: string, primary: string) => {
  const t = text.toLowerCase()
  for (const rule of CATEGORY_RULES) {
    if (rule.label === primary) continue
    if (rule.match.test(t)) return rule.label
  }
  return null
}

const getTags = (snippet: Snippet) => {
  const tags = new Set<string>()
  const primary = snippet.category && snippet.category !== 'uncategorized' ? snippet.category : null
  const alt = findAltCategory(snippet.text, primary || '')
  if (primary) tags.add(primary)
  if (alt) tags.add(alt)
  if (snippet.source) tags.add(snippet.source)
  return Array.from(tags).slice(0, 3)
}

function App() {
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [status, setStatus] = useState<HotkeyStatus>({ state: 'unavailable', reason: 'starting' })
  const [text, setText] = useState('')
  const [source, setSource] = useState('manual')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSplash, setShowSplash] = useState(true)

  const upsertSnippet = (incoming: Snippet) => {
    setSnippets((prev) => [incoming, ...prev.filter((s) => s.id !== incoming.id)])
  }

  useEffect(() => {
    let unsubSnippet: (() => void) | undefined
    let unsubStatus: (() => void) | undefined

    async function init() {
      if (!window.snippetApi) {
        setError('Preload bridge unavailable. Restart Electron via dev:app (not browser).')
        setLoading(false)
        return
      }

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

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 1800)
    return () => clearTimeout(timer)
  }, [])

  const statusText = useMemo(() => {
    if (status.state === 'ready') return `Hotkey ready (${status.accelerator || 'Ctrl/Cmd+Shift+Q'})`
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
    <div className="app">
      {showSplash && (
        <div className="splash">
          <div className="splash-inner">
            <div className="logo-word">Memonaut</div>
            <div className="logo-sub">- Second Brain</div>
          </div>
        </div>
      )}

      <div className={`app-shell ${showSplash ? 'blurred' : ''}`}>
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
                {snippets.map((snippet) => {
                  const tags = getTags(snippet)
                  return (
                    <li key={snippet.id} className="snippet aurora-card octagon">
                      <div className="snippet-header">
                        <div className="folder-container octagon">
                          <div className="folder-word">{snippet.category || 'note'}</div>
                        </div>
                        <div className="timestamp">
                          <span className="dot-pulse" />
                          <span>{formatTime(snippet.createdAt)}</span>
                        </div>
                      </div>

                      <h3 className="snippet-title">{getTitle(snippet.text)}</h3>

                      <div className="snippet-tag primary-tag">{snippet.category || 'uncategorized'}</div>

                      <p className="snippet-excerpt">{getExcerpt(snippet.text)}</p>

                      <div className="snippet-tags">
                        {tags.map((tag) => (
                          <span key={tag} className="tag octagon">#{tag}</span>
                        ))}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </main>
      </div>
    </div>
  )
}

export default App
