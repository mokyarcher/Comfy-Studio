import { useCallback, useEffect, useState } from 'react'
import { Library, Pencil, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
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

function newId(): string {
  return crypto.randomUUID()
}

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

  useEffect(() => {
    void load()
  }, [load])

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
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-medium">模板（{templates.length}）</h2>
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
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-medium">短语芯片（{phrases.length}）</h2>
          <button
            className="btn-secondary !py-1.5 text-xs"
            onClick={() => setPhraseForm({ text: '', category: '质量' })}
          >
            <Plus className="h-3.5 w-3.5" />
            添加短语
          </button>
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
