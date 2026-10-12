import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { PhraseChip, PromptTemplate } from '../../../shared/types'
import { toUserErrorMessage } from '../../../shared/errors'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useAppStore } from '../stores/appStore'

type Tab = 'local' | 'official'

type OfficialCache = {
  version: number
  updatedAt: string
  syncedAt: string
  templates: PromptTemplate[]
  phrases: PhraseChip[]
} | null

export function PromptsPage() {
  const qc = useQueryClient()
  const applyReuse = useAppStore((s) => s.applyReuse)
  const setDraft = useAppStore((s) => s.setDraft)
  const draft = useAppStore((s) => s.draft)
  const showToast = useAppStore((s) => s.showToast)
  const setPage = useAppStore((s) => s.setPage)
  const activeProfileId = useAppStore((s) => s.activeProfileId)

  const [tab, setTab] = useState<Tab>('official')
  const [refreshing, setRefreshing] = useState(false)
  const [editing, setEditing] = useState<Partial<PromptTemplate> | null>(null)
  const [phraseForm, setPhraseForm] = useState<{ id?: string; text: string; category: string } | null>(
    null
  )
  const [deleteTpl, setDeleteTpl] = useState<string | null>(null)

  const localQuery = useQuery({
    queryKey: ['prompts'],
    queryFn: () =>
      window.studio.listPrompts() as Promise<{ templates: PromptTemplate[]; phrases: PhraseChip[] }>
  })

  const officialQuery = useQuery({
    queryKey: ['prompts-official'],
    queryFn: () => window.studio.listOfficialPrompts() as Promise<OfficialCache>
  })

  const isLocal = tab === 'local'
  const templates = isLocal
    ? (localQuery.data?.templates ?? [])
    : (officialQuery.data?.templates ?? [])
  const phrases = isLocal ? (localQuery.data?.phrases ?? []) : (officialQuery.data?.phrases ?? [])

  const phraseGroups = useMemo(() => {
    const map = new Map<string, PhraseChip[]>()
    for (const p of phrases) {
      const key = p.category || '其它'
      const list = map.get(key) ?? []
      list.push(p)
      map.set(key, list)
    }
    return Array.from(map.entries())
  }, [phrases])

  const insertTemplate = (t: PromptTemplate) => {
    applyReuse({
      prompt: t.prompt,
      negativePrompt: t.negativePrompt
    })
    showToast('success', '已插入')
  }

  const insertPhrase = (p: PhraseChip) => {
    const next = draft.prompt ? `${draft.prompt}, ${p.text}` : p.text
    setDraft({ prompt: next })
    setPage('create')
    showToast('info', `已追加 ${p.text}`)
  }

  const refreshOfficial = async () => {
    if (!activeProfileId) {
      showToast('error', '请先登录并配置连接')
      return
    }
    setRefreshing(true)
    try {
      await window.studio.refreshOfficialPrompts({ profileId: activeProfileId })
      await qc.invalidateQueries({ queryKey: ['prompts-official'] })
      showToast('success', '已同步')
    } catch (err) {
      showToast('error', toUserErrorMessage(err))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold tracking-tight">提示词库</h1>
          <div className="flex rounded-lg border border-border bg-panel-elevated p-0.5">
            {(
              [
                { id: 'official' as const, label: '官方' },
                { id: 'local' as const, label: '本地' }
              ] as const
            ).map((t) => {
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`rounded-md px-3 py-1.5 text-xs transition ${
                    active ? 'bg-primary/20 text-primary' : 'text-muted hover:text-text'
                  }`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
          {!isLocal && officialQuery.data ? (
            <span className="text-[11px] text-muted/70">v{officialQuery.data.version}</span>
          ) : null}
        </div>

        {isLocal ? (
          <div className="flex gap-2">
            <button
              className="btn-secondary !py-1.5 text-xs"
              onClick={() => setPhraseForm({ text: '', category: '质量' })}
            >
              <Plus className="h-3.5 w-3.5" />
              短语
            </button>
            <button
              className="btn-primary !py-1.5 text-xs"
              onClick={() => setEditing({ title: '', prompt: '', negativePrompt: '', tags: [] })}
            >
              <Plus className="h-3.5 w-3.5" />
              模板
            </button>
          </div>
        ) : (
          <button
            className="btn-secondary !py-1.5 text-xs"
            disabled={refreshing}
            title="从服务器同步官方库"
            onClick={() => void refreshOfficial()}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            同步
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              className="group relative flex flex-col rounded-lg border border-border bg-panel p-4 text-left transition hover:border-primary/40 hover:bg-panel-elevated"
              onClick={() => insertTemplate(t)}
            >
              {isLocal && (
                <div
                  className="absolute right-2 top-2 flex gap-0.5 opacity-0 transition group-hover:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="btn-ghost !p-1.5"
                    onClick={() => setEditing(t)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="btn-ghost !p-1.5"
                    onClick={() => setDeleteTpl(t.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-danger" />
                  </button>
                </div>
              )}
              <h3 className="pr-14 text-sm font-medium text-text">{t.title}</h3>
              <p className="mt-2 line-clamp-3 flex-1 text-xs leading-relaxed text-muted">{t.prompt}</p>
              {t.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {t.tags.slice(0, 4).map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-bg px-1.5 py-0.5 text-[10px] text-muted"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>

        {templates.length === 0 && (
          <div className="mb-8 flex h-28 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted">
            {isLocal ? '还没有模板' : refreshing ? '同步中…' : '点击右上角同步'}
          </div>
        )}

        {phraseGroups.length > 0 && (
          <div className="space-y-4 border-t border-border pt-5">
            {phraseGroups.map(([category, items]) => (
              <div key={category}>
                <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted/80">
                  {category}
                </div>
                <div className="flex flex-wrap gap-2">
                  {items.map((p: PhraseChip) => (
                    <button
                      key={p.id}
                      type="button"
                      className="rounded-md border border-border bg-panel-elevated px-2.5 py-1 text-xs text-text transition hover:border-primary/45 hover:text-primary"
                      onClick={() => insertPhrase(p)}
                      onContextMenu={(e) => {
                        if (!isLocal) return
                        e.preventDefault()
                        setPhraseForm(p)
                      }}
                    >
                      {p.text}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && isLocal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="card w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 font-semibold">{editing.id ? '编辑模板' : '新建模板'}</h3>
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
                <label className="label">负向</label>
                <textarea
                  className="input min-h-[70px]"
                  value={editing.negativePrompt || ''}
                  onChange={(e) => setEditing({ ...editing, negativePrompt: e.target.value })}
                />
              </div>
              <div>
                <label className="label">标签</label>
                <input
                  className="input"
                  placeholder="逗号分隔"
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
                onClick={async () => {
                  if (!editing.title?.trim() || !editing.prompt?.trim()) {
                    showToast('error', '请填写标题和提示词')
                    return
                  }
                  await window.studio.saveTemplate({
                    id: editing.id,
                    title: editing.title,
                    prompt: editing.prompt,
                    negativePrompt: editing.negativePrompt,
                    tags: editing.tags
                  })
                  setEditing(null)
                  void qc.invalidateQueries({ queryKey: ['prompts'] })
                  showToast('success', '已保存')
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {phraseForm && isLocal && (
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
                  onClick={async () => {
                    await window.studio.deletePhrase(phraseForm.id!)
                    setPhraseForm(null)
                    void qc.invalidateQueries({ queryKey: ['prompts'] })
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
                  onClick={async () => {
                    if (!phraseForm.text.trim()) return
                    await window.studio.savePhrase(phraseForm)
                    setPhraseForm(null)
                    void qc.invalidateQueries({ queryKey: ['prompts'] })
                    showToast('success', '已保存')
                  }}
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTpl)}
        title="删除模板？"
        message="删除后不可恢复。"
        confirmText="删除"
        danger
        onCancel={() => setDeleteTpl(null)}
        onConfirm={async () => {
          if (!deleteTpl) return
          await window.studio.deleteTemplate(deleteTpl)
          setDeleteTpl(null)
          void qc.invalidateQueries({ queryKey: ['prompts'] })
        }}
      />
    </div>
  )
}
