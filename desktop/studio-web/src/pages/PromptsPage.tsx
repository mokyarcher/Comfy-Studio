import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PromptTranslateButton } from '@/components/PromptTranslateButton'
import { SlidingSeg } from '@/components/SlidingSeg'
import {
  deleteSharedPrompt,
  fetchPromptLibrary,
  listSharedPrompts,
  sharePromptTemplate
} from '@/lib/api'
import type { PromptTemplate, SharedPrompt } from '@/lib/types'
import { useSession } from '@/store/session'
import { useToast } from '@/store/toast'

type Tab = 'official' | 'shared' | 'local'

const LOCAL_KEY = 'comfy-studio-web-local-prompts'

function itemTags(item: PromptTemplate | SharedPrompt): string[] {
  return Array.isArray(item.tags) ? item.tags.map((t) => String(t).trim()).filter(Boolean) : []
}

export function PromptsPage() {
  const apiKey = useSession((s) => s.user!.apiKey)
  const push = useToast((s) => s.push)
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('official')
  const [official, setOfficial] = useState<PromptTemplate[]>([])
  const [shared, setShared] = useState<SharedPrompt[]>([])
  const [local, setLocal] = useState<PromptTemplate[]>([])
  const [tagFilter, setTagFilter] = useState('')
  const [draft, setDraft] = useState({ title: '', prompt: '', negative: '', tags: '' })

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCAL_KEY)
      if (raw) setLocal(JSON.parse(raw) as PromptTemplate[])
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        if (tab === 'official') {
          const lib = await fetchPromptLibrary({ apiKey })
          setOfficial(lib.templates || [])
        } else if (tab === 'shared') {
          const r = await listSharedPrompts({ apiKey })
          setShared(r.items || [])
        }
      } catch (err) {
        push(err instanceof Error ? err.message : '加载失败', 'error')
      }
    })()
  }, [tab, apiKey, push])

  function usePrompt(prompt: string, negative?: string | null) {
    sessionStorage.setItem(
      'comfy-studio-web-apply-prompt',
      JSON.stringify({ prompt, negative: negative || '' })
    )
    navigate('/create')
  }

  function saveLocal() {
    if (!draft.title.trim() || !draft.prompt.trim()) {
      push('请填写标题与提示词', 'error')
      return
    }
    const item: PromptTemplate = {
      id: crypto.randomUUID(),
      title: draft.title.trim(),
      prompt: draft.prompt.trim(),
      negative_prompt: draft.negative.trim() || undefined,
      tags: draft.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    }
    const next = [item, ...local]
    setLocal(next)
    localStorage.setItem(LOCAL_KEY, JSON.stringify(next))
    setDraft({ title: '', prompt: '', negative: '', tags: '' })
    push('已保存到本地库', 'success')
  }

  const list = tab === 'official' ? official : tab === 'shared' ? shared : local

  const allTags = useMemo(() => {
    const freq = new Map<string, number>()
    for (const item of list) {
      for (const tag of itemTags(item)) {
        freq.set(tag, (freq.get(tag) ?? 0) + 1)
      }
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
      .map(([tag]) => tag)
  }, [list])

  const filtered = useMemo(() => {
    if (!tagFilter) return list
    return list.filter((item) => itemTags(item).includes(tagFilter))
  }, [list, tagFilter])

  useEffect(() => {
    setTagFilter('')
  }, [tab])

  return (
    <div className="page space-y-4">
      <div className="page-header mb-0">
        <h1 className="page-title">提示词库</h1>
        <SlidingSeg
          aria-label="提示词库来源"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'official', label: '官方' },
            { value: 'local', label: '本地' },
            { value: 'shared', label: '共享库' }
          ]}
        />
      </div>

      {allTags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className={`px-2.5 py-1 text-xs ${tagFilter === '' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTagFilter('')}
          >
            全部 ({list.length})
          </button>
          {allTags.map((tag) => {
            const count = list.filter((item) => itemTags(item).includes(tag)).length
            return (
              <button
                key={tag}
                type="button"
                className={`px-2.5 py-1 text-xs ${tagFilter === tag ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setTagFilter((cur) => (cur === tag ? '' : tag))}
              >
                {tag} ({count})
              </button>
            )
          })}
        </div>
      ) : null}

      {tab === 'local' ? (
        <div className="card grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
          <p className="text-sm text-muted sm:col-span-2">新建本地模板</p>
          <input
            className="input sm:col-span-2"
            placeholder="标题"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <textarea
            className="input min-h-[5.5rem] sm:col-span-2"
            placeholder="提示词"
            value={draft.prompt}
            onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
          />
          <textarea
            className="input min-h-[3.5rem]"
            placeholder="负向"
            value={draft.negative}
            onChange={(e) => setDraft({ ...draft, negative: e.target.value })}
          />
          <input
            className="input"
            placeholder="标签，逗号分隔"
            value={draft.tags}
            onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
          />
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="button" className="btn-primary" onClick={saveLocal}>
              保存本地
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={async () => {
                try {
                  await sharePromptTemplate({
                    apiKey,
                    title: draft.title,
                    prompt: draft.prompt,
                    negativePrompt: draft.negative,
                    tags: draft.tags
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean)
                  })
                  push('已投稿到共享库', 'success')
                } catch (err) {
                  push(err instanceof Error ? err.message : '投稿失败', 'error')
                }
              }}
            >
              投稿共享库
            </button>
          </div>
        </div>
      ) : null}

      {!filtered.length ? (
        <div className="empty-state min-h-[12rem]">
          <p className="text-sm text-muted">{list.length ? '该标签下暂无模板' : '暂无模板'}</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => {
            const tags = itemTags(item)
            return (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                className="card flex cursor-pointer flex-col p-4 text-left transition hover:border-white/30"
                onClick={() => usePrompt(item.prompt, item.negative_prompt)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    usePrompt(item.prompt, item.negative_prompt)
                  }
                }}
              >
                <h3 className="text-sm font-medium text-text">{item.title}</h3>
                {'author_name' in item && item.author_name ? (
                  <p className="mt-0.5 text-[11px] text-muted">来自 {item.author_name}</p>
                ) : null}
                {tags.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
                    {tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className={`rounded-md px-1.5 py-0.5 text-[10px] leading-4 ${
                          tagFilter === tag
                            ? 'bg-white/25 text-text'
                            : 'bg-white/10 text-muted hover:bg-white/16 hover:text-text'
                        }`}
                        onClick={() => setTagFilter((cur) => (cur === tag ? '' : tag))}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                ) : null}
                <p className="mt-2 line-clamp-4 flex-1 text-xs leading-relaxed text-muted">{item.prompt}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <PromptTranslateButton text={item.prompt} stopPropagation />
                  {'mine' in item && item.mine ? (
                    <button
                      type="button"
                      className="btn-danger text-xs"
                      onClick={async () => {
                        await deleteSharedPrompt({ apiKey, itemId: item.id })
                        push('已删除', 'success')
                        setTab('shared')
                        const r = await listSharedPrompts({ apiKey })
                        setShared(r.items || [])
                      }}
                    >
                      删除
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
