import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Pencil, Plus, RefreshCw, Share2, Trash2 } from 'lucide-react'
import type { PhraseChip, PromptTemplate, SharedPromptTemplate } from '../../../shared/types'
import { toUserErrorMessage } from '../../../shared/errors'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { PromptTranslateButton } from '../components/PromptTranslate'
import { formatDateTime } from '../lib/format'
import { useAppStore } from '../stores/appStore'

type Tab = 'local' | 'official' | 'shared'

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
  const [sharingId, setSharingId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Partial<PromptTemplate> | null>(null)
  const [phraseForm, setPhraseForm] = useState<{ id?: string; text: string; category: string } | null>(
    null
  )
  const [deleteTpl, setDeleteTpl] = useState<string | null>(null)
  const [deleteSharedId, setDeleteSharedId] = useState<string | null>(null)

  const localQuery = useQuery({
    queryKey: ['prompts'],
    queryFn: () =>
      window.studio.listPrompts() as Promise<{ templates: PromptTemplate[]; phrases: PhraseChip[] }>
  })

  const officialQuery = useQuery({
    queryKey: ['prompts-official'],
    queryFn: () => window.studio.listOfficialPrompts() as Promise<OfficialCache>
  })

  const officialUpdateQuery = useQuery({
    queryKey: ['prompts-official-update', activeProfileId],
    enabled: Boolean(activeProfileId) && tab === 'official',
    refetchInterval: 60_000,
    queryFn: async () =>
      (await window.studio.checkOfficialUpdate({
        profileId: activeProfileId
      })) as {
        hasUpdate: boolean
        remoteVersion: number
        remoteUpdatedAt: string
        localVersion: number
        localUpdatedAt: string
      }
  })

  const sharedQuery = useQuery({
    queryKey: ['prompts-shared', activeProfileId],
    enabled: Boolean(activeProfileId) && tab === 'shared',
    queryFn: async () => {
      const res = (await window.studio.listSharedPrompts({
        profileId: activeProfileId
      })) as { items: SharedPromptTemplate[]; count: number }
      return res
    }
  })

  const officialHasUpdate = Boolean(officialUpdateQuery.data?.hasUpdate)

  const isLocal = tab === 'local'
  const isShared = tab === 'shared'
  const templates = isLocal
    ? (localQuery.data?.templates ?? [])
    : isShared
      ? []
      : (officialQuery.data?.templates ?? [])
  const sharedItems = sharedQuery.data?.items ?? []
  const phrases = isLocal
    ? (localQuery.data?.phrases ?? [])
    : isShared
      ? []
      : (officialQuery.data?.phrases ?? [])

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

  const insertTemplate = (t: { prompt: string; negativePrompt?: string | null }) => {
    applyReuse({
      prompt: t.prompt,
      negativePrompt: t.negativePrompt || undefined
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
      await qc.invalidateQueries({ queryKey: ['prompts-official-update'] })
      showToast('success', '已同步')
    } catch (err) {
      showToast('error', toUserErrorMessage(err))
    } finally {
      setRefreshing(false)
    }
  }

  const refreshShared = async () => {
    if (!activeProfileId) {
      showToast('error', '请先登录并配置连接')
      return
    }
    setRefreshing(true)
    try {
      await qc.invalidateQueries({ queryKey: ['prompts-shared', activeProfileId] })
      await sharedQuery.refetch()
      showToast('success', '已刷新')
    } catch (err) {
      showToast('error', toUserErrorMessage(err))
    } finally {
      setRefreshing(false)
    }
  }

  const shareLocal = async (t: PromptTemplate) => {
    if (!activeProfileId) {
      showToast('error', '请先登录')
      return
    }
    setSharingId(t.id)
    try {
      await window.studio.shareToSharedLibrary({
        profileId: activeProfileId,
        title: t.title,
        prompt: t.prompt,
        negativePrompt: t.negativePrompt,
        tags: t.tags
      })
      void qc.invalidateQueries({ queryKey: ['prompts-shared'] })
      showToast('success', '已分享到共享库')
    } catch (err) {
      showToast('error', toUserErrorMessage(err))
    } finally {
      setSharingId(null)
    }
  }

  const emptyHint = isLocal
    ? '还没有模板'
    : isShared
      ? sharedQuery.isLoading
        ? '加载中…'
        : '暂无分享，可从本地模板分享过来'
      : refreshing
        ? '同步中…'
        : '点击右上角同步'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold tracking-tight">提示词库</h1>
          <div className="flex rounded-lg border border-border bg-panel-elevated p-0.5">
            {(
              [
                { id: 'official' as const, label: '官方' },
                { id: 'local' as const, label: '本地' },
                { id: 'shared' as const, label: '共享库' }
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
          {tab === 'official' && officialQuery.data ? (
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
          <div className="flex min-w-0 items-center gap-3">
            {tab === 'official' ? (
              <div className="hidden min-w-0 text-right text-[11px] leading-relaxed text-muted sm:block">
                {officialQuery.data ? (
                  <>
                    <div className="truncate" title={officialQuery.data.syncedAt}>
                      最近拉取 {formatDateTime(officialQuery.data.syncedAt)}
                    </div>
                    <div className="truncate" title={officialQuery.data.updatedAt}>
                      服务端更新 {formatDateTime(officialQuery.data.updatedAt)}
                    </div>
                  </>
                ) : (
                  <div>尚未同步</div>
                )}
              </div>
            ) : null}
            <button
              className={`shrink-0 !py-1.5 text-xs ${
                !isShared && officialHasUpdate ? 'btn-primary' : 'btn-secondary'
              }`}
              disabled={refreshing || (isShared && !activeProfileId)}
              title={
                isShared
                  ? '刷新共享库'
                  : officialHasUpdate
                    ? '服务端有新词库，点击同步'
                    : '从服务器同步官方库'
              }
              onClick={() => void (isShared ? refreshShared() : refreshOfficial())}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {isShared ? '刷新' : officialHasUpdate ? '同步新库' : '同步'}
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {isShared ? (
          <>
            <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {sharedItems.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="group relative flex flex-col rounded-lg border border-border bg-panel p-4 text-left transition hover:border-primary/40 hover:bg-panel-elevated"
                  onClick={() => insertTemplate(t)}
                >
                  {t.mine && (
                    <div
                      className="absolute right-2 top-2 flex gap-0.5 opacity-0 transition group-hover:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="btn-ghost !p-1.5"
                        onClick={() => setDeleteSharedId(t.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-danger" />
                      </button>
                    </div>
                  )}
                  <h3 className="pr-10 text-sm font-medium text-text">{t.title}</h3>
                  <p className="mt-1 text-[11px] text-muted">
                    来自 {t.authorName || t.authorUsername}
                    {t.mine ? ' · 我的' : ''}
                  </p>
                  <p className="mt-2 line-clamp-3 flex-1 text-xs leading-relaxed text-muted">
                    {t.prompt}
                  </p>
                  <PromptTranslateButton
                    text={t.prompt}
                    className="mt-2"
                    stopPropagation
                  />
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
            {sharedItems.length === 0 && (
              <div className="mb-8 flex h-28 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted">
                {!activeProfileId ? '请先登录' : emptyHint}
              </div>
            )}
          </>
        ) : (
          <>
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
                        title="分享到共享库"
                        disabled={sharingId === t.id}
                        onClick={() => void shareLocal(t)}
                      >
                        <Share2 className="h-3.5 w-3.5" />
                      </button>
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
                  <p className="mt-2 line-clamp-3 flex-1 text-xs leading-relaxed text-muted">
                    {t.prompt}
                  </p>
                  <PromptTranslateButton
                    text={t.prompt}
                    className="mt-2"
                    stopPropagation
                  />
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
                {emptyHint}
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
          </>
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

      <ConfirmDialog
        open={Boolean(deleteSharedId)}
        title="从共享库移除？"
        message="将删除你分享的这条模板，其他人将看不到。"
        confirmText="删除"
        danger
        onCancel={() => setDeleteSharedId(null)}
        onConfirm={async () => {
          if (!deleteSharedId || !activeProfileId) return
          try {
            await window.studio.deleteSharedPrompt({
              profileId: activeProfileId,
              itemId: deleteSharedId
            })
            setDeleteSharedId(null)
            void qc.invalidateQueries({ queryKey: ['prompts-shared'] })
            showToast('success', '已删除')
          } catch (err) {
            showToast('error', toUserErrorMessage(err))
          }
        }}
      />
    </div>
  )
}
