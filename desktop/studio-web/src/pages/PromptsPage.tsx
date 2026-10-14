import { useEffect, useState } from 'react'
import {
  deleteSharedPrompt,
  fetchPromptLibrary,
  listSharedPrompts,
  sharePromptTemplate
} from '@/lib/api'
import type { PromptTemplate, SharedPrompt } from '@/lib/types'
import { useSession } from '@/store/session'
import { useToast } from '@/store/toast'
import { useNavigate } from 'react-router-dom'

type Tab = 'official' | 'shared' | 'local'

const LOCAL_KEY = 'comfy-studio-web-local-prompts'

export function PromptsPage() {
  const apiKey = useSession((s) => s.user!.apiKey)
  const push = useToast((s) => s.push)
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('official')
  const [official, setOfficial] = useState<PromptTemplate[]>([])
  const [shared, setShared] = useState<SharedPrompt[]>([])
  const [local, setLocal] = useState<PromptTemplate[]>([])
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
    push('已带到创作页（刷新后请重新选用）', 'success')
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

  const list =
    tab === 'official' ? official : tab === 'shared' ? shared : local

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-lg font-medium text-text">提示词库</h1>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['official', '官方'],
            ['local', '本地'],
            ['shared', '共享库']
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`rounded-lg px-3 py-1.5 text-sm ${tab === id ? 'bg-primary/20 text-primary' : 'bg-panel text-muted'}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'local' ? (
        <div className="card space-y-2 p-4">
          <p className="text-sm text-muted">新建本地模板</p>
          <input className="input" placeholder="标题" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <textarea className="input min-h-[5rem]" placeholder="提示词" value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} />
          <textarea className="input min-h-[3rem]" placeholder="负向" value={draft.negative} onChange={(e) => setDraft({ ...draft, negative: e.target.value })} />
          <input className="input" placeholder="标签，逗号分隔" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
          <div className="flex gap-2">
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
                    tags: draft.tags.split(',').map((t) => t.trim()).filter(Boolean)
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

      <div className="grid gap-3 sm:grid-cols-2">
        {list.map((item) => (
          <div key={item.id} className="card p-4">
            <h3 className="text-sm font-medium text-text">{item.title}</h3>
            {'author_name' in item && item.author_name ? (
              <p className="text-[11px] text-muted">来自 {item.author_name}</p>
            ) : null}
            <p className="mt-2 line-clamp-4 text-xs text-muted">{item.prompt}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={() => usePrompt(item.prompt, item.negative_prompt)}
              >
                选用
              </button>
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
        ))}
      </div>
    </div>
  )
}
