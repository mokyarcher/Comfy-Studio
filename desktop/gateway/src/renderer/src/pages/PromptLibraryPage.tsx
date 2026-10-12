import { useCallback, useEffect, useRef, useState } from 'react'
import { FileJson, Library, Pencil, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { useAppStore } from '../stores/appStore'

type Template = {
  id: string
  title: string
  prompt: string
  negative_prompt?: string
  tags?: string[]
  created_at?: string
  updated_at?: string
}

type Phrase = {
  id: string
  text: string
  category: string
}

type SharedItem = {
  id: string
  title: string
  prompt: string
  author_name: string
  author_username: string
  created_at: string
}

function newId(): string {
  return crypto.randomUUID()
}

function normalizeTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).trim()).filter(Boolean)
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean)
  }
  return []
}

function parseTemplateRow(row: unknown): Template | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const title = String(r.title ?? '').trim()
  const prompt = String(r.prompt ?? '').trim()
  if (!title || !prompt) return null
  return {
    id: String(r.id ?? '').trim() || newId(),
    title,
    prompt,
    negative_prompt: String(r.negative_prompt ?? r.negativePrompt ?? '').trim(),
    tags: normalizeTags(r.tags)
  }
}

function parsePhraseRow(row: unknown): Phrase | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const text = String(r.text ?? '').trim()
  if (!text) return null
  return {
    id: String(r.id ?? '').trim() || newId(),
    text,
    category: String(r.category ?? '').trim() || '通用'
  }
}

/** `{ "templates": [...] }` or a bare templates array. */
function parseTemplateImportJson(text: string): Template[] {
  const raw = JSON.parse(text) as unknown
  let rows: unknown[] = []
  if (Array.isArray(raw)) {
    rows = raw
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    if (!Array.isArray(obj.templates)) {
      throw new Error('对象需含 templates 数组')
    }
    rows = obj.templates
  } else {
    throw new Error('JSON 须为对象或模板数组')
  }
  const templates = rows.map(parseTemplateRow).filter((x): x is Template => x != null)
  if (templates.length === 0) throw new Error('没有有效模板（每项需 title + prompt）')
  return templates
}

/** `{ "phrases": [...] }` or a bare phrases array. */
function parsePhraseImportJson(text: string): Phrase[] {
  const raw = JSON.parse(text) as unknown
  let rows: unknown[] = []
  if (Array.isArray(raw)) {
    rows = raw
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    if (!Array.isArray(obj.phrases)) {
      throw new Error('对象需含 phrases 数组')
    }
    rows = obj.phrases
  } else {
    throw new Error('JSON 须为对象或短语数组')
  }
  const phrases = rows.map(parsePhraseRow).filter((x): x is Phrase => x != null)
  if (phrases.length === 0) throw new Error('没有有效短语（每项需 text）')
  return phrases
}

function mergeById<T extends { id: string }>(list: T[], imported: T[]): T[] {
  const byId = new Map(list.map((x) => [x.id, x]))
  const added: T[] = []
  for (const item of imported) {
    if (byId.has(item.id)) byId.set(item.id, item)
    else {
      added.push(item)
      byId.set(item.id, item)
    }
  }
  const rest = list.map((x) => byId.get(x.id)!).filter(Boolean)
  return [...added, ...rest]
}

const TEMPLATE_IMPORT_HINT = `{
  "templates": [
    {
      "title": "电影级人像",
      "prompt": "cinematic portrait…",
      "negative_prompt": "blurry, watermark",
      "tags": ["人像", "电影"]
    }
  ]
}`

const PHRASE_IMPORT_HINT = `{
  "phrases": [
    { "text": "highly detailed", "category": "质量" },
    { "text": "cinematic lighting", "category": "光线" }
  ]
}`

export function PromptLibraryPage() {
  const showToast = useAppStore((s) => s.showToast)
  const [templates, setTemplates] = useState<Template[]>([])
  const [phrases, setPhrases] = useState<Phrase[]>([])
  const [version, setVersion] = useState(0)
  const [updatedAt, setUpdatedAt] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Partial<Template> | null>(null)
  const [phraseForm, setPhraseForm] = useState<{ id?: string; text: string; category: string } | null>(
    null
  )
  const [importKind, setImportKind] = useState<'templates' | 'phrases' | null>(null)
  const [importText, setImportText] = useState('')
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append')
  const [importError, setImportError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [sharedItems, setSharedItems] = useState<SharedItem[]>([])
  const [sharedLoading, setSharedLoading] = useState(false)
  const [sharedError, setSharedError] = useState('')

  const openImport = (kind: 'templates' | 'phrases') => {
    setImportError('')
    setImportText('')
    setImportMode('append')
    setImportKind(kind)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await window.gateway.adminGetPromptLibrary()
      if (!res.ok || !res.library) {
        setError(res.message || '读取失败')
        return
      }
      setTemplates(res.library.templates ?? [])
      setPhrases(res.library.phrases ?? [])
      setVersion(res.library.version ?? 0)
      setUpdatedAt(res.library.updated_at ?? '')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadShared = useCallback(async () => {
    setSharedLoading(true)
    setSharedError('')
    try {
      const res = await window.gateway.adminListSharedPrompts()
      if (!res.ok) {
        setSharedError(res.message || '读取共享库失败')
        setSharedItems([])
        return
      }
      setSharedItems((res.items ?? []) as SharedItem[])
    } finally {
      setSharedLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    void loadShared()
  }, [load, loadShared])

  const publish = async () => {
    setSaving(true)
    try {
      const res = await window.gateway.adminReplacePromptLibrary({ templates, phrases })
      if (!res.ok || !res.library) {
        showToast('error', res.message)
        return
      }
      setTemplates(res.library.templates ?? [])
      setPhrases(res.library.phrases ?? [])
      setVersion(res.library.version ?? 0)
      setUpdatedAt(res.library.updated_at ?? '')
      showToast('success', res.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Library className="h-5 w-5 text-primary" />
            官方提示词库
          </h1>
          <p className="page-desc">
            在此维护后发布；Studio 用户可刷新拉取。与用户本机「本地库」互不覆盖。
          </p>
          <p className="mt-1 text-xs text-muted">
            版本 v{version}
            {updatedAt ? ` · 更新于 ${new Date(updatedAt).toLocaleString()}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" disabled={loading || saving} onClick={() => void load()}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            重新加载
          </button>
          <button className="btn-primary" disabled={loading || saving} onClick={() => void publish()}>
            <Save className="h-4 w-4" />
            {saving ? '发布中…' : '发布到服务器'}
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-medium">玩家共享库（{sharedItems.length}）</h2>
            <p className="mt-0.5 text-xs text-muted">Studio 用户从本地分享的模板；可在此删除不当内容。</p>
          </div>
          <button
            className="btn-secondary !py-1.5 text-xs"
            disabled={sharedLoading}
            onClick={() => void loadShared()}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${sharedLoading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
        {sharedError ? <p className="mb-2 text-sm text-danger">{sharedError}</p> : null}
        {sharedItems.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            {sharedLoading ? '加载中…' : '暂无玩家分享'}
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {sharedItems.map((item) => (
              <div
                key={item.id}
                className="flex flex-col rounded-lg border border-border bg-bg/40 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text">{item.title}</p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      来自 {item.author_name || item.author_username}
                      {item.created_at
                        ? ` · ${new Date(item.created_at).toLocaleString()}`
                        : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost !p-1.5 shrink-0"
                    title="删除"
                    onClick={async () => {
                      const res = await window.gateway.adminDeleteSharedPrompt(item.id)
                      if (!res.ok) {
                        showToast('error', res.message)
                        return
                      }
                      showToast('success', '已删除')
                      void loadShared()
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-danger" />
                  </button>
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted">{item.prompt}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">模板（{templates.length}）</h2>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary !py-1.5 text-xs"
              onClick={() => openImport('templates')}
            >
              <FileJson className="h-3.5 w-3.5" />
              模板 JSON
            </button>
            <button
              className="btn-secondary !py-1.5 text-xs"
              onClick={() =>
                setEditing({ id: newId(), title: '', prompt: '', negative_prompt: '', tags: [] })
              }
            >
              <Plus className="h-3.5 w-3.5" />
              新建模板
            </button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {templates.map((t) => (
            <div key={t.id} className="rounded-lg border border-border bg-panel-elevated p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3 className="text-sm font-medium">{t.title}</h3>
                <div className="flex gap-1">
                  <button className="btn-ghost !p-1.5" onClick={() => setEditing({ ...t })}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="btn-ghost !p-1.5"
                    onClick={() => setTemplates((list) => list.filter((x) => x.id !== t.id))}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-danger" />
                  </button>
                </div>
              </div>
              <p className="line-clamp-3 text-xs text-muted">{t.prompt}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {(t.tags || []).map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {templates.length === 0 && (
            <p className="text-sm text-muted md:col-span-2">暂无模板，点击「新建模板」开始维护。</p>
          )}
        </div>
      </section>

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">短语芯片（{phrases.length}）</h2>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary !py-1.5 text-xs"
              onClick={() => openImport('phrases')}
            >
              <FileJson className="h-3.5 w-3.5" />
              芯片 JSON
            </button>
            <button
              className="btn-secondary !py-1.5 text-xs"
              onClick={() => setPhraseForm({ text: '', category: '质量' })}
            >
              <Plus className="h-3.5 w-3.5" />
              添加短语
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {phrases.map((p) => (
            <button
              key={p.id}
              type="button"
              className="rounded-lg border border-border bg-panel-elevated px-3 py-1.5 text-xs hover:border-primary/40"
              onClick={() => setPhraseForm({ ...p })}
              title="点击编辑"
            >
              <span className="mr-1 text-[10px] text-muted">{p.category}</span>
              {p.text}
            </button>
          ))}
          {phrases.length === 0 && <p className="text-sm text-muted">暂无短语</p>}
        </div>
      </section>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="card w-full max-w-lg p-5">
            <h3 className="mb-4 font-semibold">
              {templates.some((t) => t.id === editing.id) ? '编辑模板' : '新建模板'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="label">标题</label>
                <input
                  className="input"
                  value={editing.title || ''}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                />
              </div>
              <div>
                <label className="label">提示词</label>
                <textarea
                  className="input min-h-[120px]"
                  value={editing.prompt || ''}
                  onChange={(e) => setEditing({ ...editing, prompt: e.target.value })}
                />
              </div>
              <div>
                <label className="label">负向提示词</label>
                <textarea
                  className="input min-h-[70px]"
                  value={editing.negative_prompt || ''}
                  onChange={(e) => setEditing({ ...editing, negative_prompt: e.target.value })}
                />
              </div>
              <div>
                <label className="label">标签（逗号分隔）</label>
                <input
                  className="input"
                  value={(editing.tags || []).join(', ')}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      tags: e.target.value
                        .split(',')
                        .map((x) => x.trim())
                        .filter(Boolean)
                    })
                  }
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setEditing(null)}>
                取消
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  if (!editing.title?.trim() || !editing.prompt?.trim()) {
                    showToast('error', '请填写标题和提示词')
                    return
                  }
                  const next: Template = {
                    id: editing.id || newId(),
                    title: editing.title.trim(),
                    prompt: editing.prompt.trim(),
                    negative_prompt: (editing.negative_prompt || '').trim(),
                    tags: editing.tags || []
                  }
                  setTemplates((list) => {
                    const idx = list.findIndex((x) => x.id === next.id)
                    if (idx >= 0) {
                      const copy = [...list]
                      copy[idx] = next
                      return copy
                    }
                    return [next, ...list]
                  })
                  setEditing(null)
                }}
              >
                写入列表
              </button>
            </div>
          </div>
        </div>
      )}

      {importKind && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="card flex max-h-[90vh] w-full max-w-2xl flex-col p-5">
            <h3 className="mb-1 font-semibold">
              {importKind === 'templates' ? '模板 JSON 导入' : '芯片 JSON 导入'}
            </h3>
            <p className="mb-3 text-xs text-muted">导入后需再点「发布到服务器」。</p>
            <pre className="mb-3 max-h-28 overflow-auto rounded-lg border border-border bg-panel-elevated p-2 text-[10px] leading-relaxed text-muted">
              {importKind === 'templates' ? TEMPLATE_IMPORT_HINT : PHRASE_IMPORT_HINT}
            </pre>
            <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === 'append'}
                  onChange={() => setImportMode('append')}
                />
                {importKind === 'templates' ? '追加到模板列表' : '追加到芯片列表'}
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                />
                {importKind === 'templates' ? '替换全部模板' : '替换全部芯片'}
              </label>
              <button
                type="button"
                className="btn-ghost !py-1 text-xs"
                onClick={() => fileRef.current?.click()}
              >
                选择 .json 文件
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  const reader = new FileReader()
                  reader.onload = () => {
                    setImportText(String(reader.result ?? ''))
                    setImportError('')
                  }
                  reader.onerror = () => setImportError('读取文件失败')
                  reader.readAsText(file, 'utf-8')
                }}
              />
            </div>
            <textarea
              className="input min-h-[180px] flex-1 font-mono text-xs"
              placeholder="粘贴 JSON…"
              value={importText}
              onChange={(e) => {
                setImportText(e.target.value)
                setImportError('')
              }}
            />
            {importError ? <p className="mt-2 text-xs text-danger">{importError}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setImportKind(null)}>
                取消
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  try {
                    if (importKind === 'templates') {
                      const imported = parseTemplateImportJson(importText)
                      setTemplates((list) =>
                        importMode === 'replace' ? imported : mergeById(list, imported)
                      )
                      showToast('success', `已导入模板 ${imported.length}（尚未发布）`)
                    } else {
                      const imported = parsePhraseImportJson(importText)
                      setPhrases((list) =>
                        importMode === 'replace' ? imported : mergeById(list, imported)
                      )
                      showToast('success', `已导入芯片 ${imported.length}（尚未发布）`)
                    }
                    setImportKind(null)
                  } catch (err) {
                    setImportError(err instanceof Error ? err.message : 'JSON 解析失败')
                  }
                }}
              >
                导入到列表
              </button>
            </div>
          </div>
        </div>
      )}

      {phraseForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="card w-full max-w-md p-5">
            <h3 className="mb-4 font-semibold">{phraseForm.id ? '编辑短语' : '添加短语'}</h3>
            <div className="space-y-3">
              <div>
                <label className="label">文本</label>
                <input
                  className="input"
                  value={phraseForm.text}
                  onChange={(e) => setPhraseForm({ ...phraseForm, text: e.target.value })}
                />
              </div>
              <div>
                <label className="label">分类</label>
                <input
                  className="input"
                  value={phraseForm.category}
                  onChange={(e) => setPhraseForm({ ...phraseForm, category: e.target.value })}
                />
              </div>
            </div>
            <div className="mt-5 flex justify-between">
              {phraseForm.id ? (
                <button
                  className="btn-danger"
                  onClick={() => {
                    setPhrases((list) => list.filter((x) => x.id !== phraseForm.id))
                    setPhraseForm(null)
                  }}
                >
                  删除
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={() => setPhraseForm(null)}>
                  取消
                </button>
                <button
                  className="btn-primary"
                  onClick={() => {
                    if (!phraseForm.text.trim()) return
                    const next: Phrase = {
                      id: phraseForm.id || newId(),
                      text: phraseForm.text.trim(),
                      category: phraseForm.category.trim() || '通用'
                    }
                    setPhrases((list) => {
                      const idx = list.findIndex((x) => x.id === next.id)
                      if (idx >= 0) {
                        const copy = [...list]
                        copy[idx] = next
                        return copy
                      }
                      return [next, ...list]
                    })
                    setPhraseForm(null)
                  }}
                >
                  写入列表
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
