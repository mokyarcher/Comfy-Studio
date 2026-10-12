import { useCallback, useEffect, useRef, useState } from 'react'
import type { GatewayConfig } from '../../../shared/types'
import { useAppStore } from '../stores/appStore'

type FileFilter = { name: string; extensions: string[] }

/**
 * Local config draft that won't be wiped by periodic status polling
 * while the user is editing (dirty). Browse selections auto-save.
 */
export function useConfigDraft() {
  const status = useAppStore((s) => s.status)
  const saveConfig = useAppStore((s) => s.saveConfig)
  const [draft, setDraft] = useState<GatewayConfig | null>(null)
  const savedKey = useRef('')
  const dirty = useRef(false)

  useEffect(() => {
    if (!status?.config) return
    if (dirty.current) return
    const key = JSON.stringify(status.config)
    if (key === savedKey.current) return
    savedKey.current = key
    setDraft(status.config)
  }, [status?.config])

  const set = useCallback(<K extends keyof GatewayConfig>(key: K, value: GatewayConfig[K]) => {
    dirty.current = true
    setDraft((d) => (d ? { ...d, [key]: value } : d))
  }, [])

  const save = useCallback(
    async (partial?: Partial<GatewayConfig>) => {
      const base = draft
      if (!base && !partial) return
      const payload = { ...(base ?? {}), ...(partial ?? {}) } as GatewayConfig
      await saveConfig(payload)
      dirty.current = false
      savedKey.current = JSON.stringify(payload)
      setDraft(payload)
    },
    [draft, saveConfig]
  )

  const browseDir = useCallback(
    async (key: keyof GatewayConfig) => {
      const p = await window.gateway.pickDirectory()
      if (!p || !draft) return
      const next = { ...draft, [key]: p } as GatewayConfig
      setDraft(next)
      dirty.current = false
      await saveConfig(next)
      savedKey.current = JSON.stringify(next)
    },
    [draft, saveConfig]
  )

  const browseFile = useCallback(
    async (key: keyof GatewayConfig, filters?: FileFilter[]) => {
      const p = await window.gateway.pickFile(filters)
      if (!p || !draft) return
      const next = { ...draft, [key]: p } as GatewayConfig
      setDraft(next)
      dirty.current = false
      await saveConfig(next)
      savedKey.current = JSON.stringify(next)
    },
    [draft, saveConfig]
  )

  return { draft, set, save, browseDir, browseFile, status }
}
