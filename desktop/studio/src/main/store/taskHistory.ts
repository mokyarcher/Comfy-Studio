import { existsSync, readFileSync, writeFileSync } from 'fs'
import type { LocalTask } from '../../shared/types'
import { taskHistoryPath } from './paths'

const MAX_TASKS = 120

interface TaskHistoryFile {
  version: 1
  items: LocalTask[]
}

function stripHeavyFields(task: LocalTask): LocalTask {
  const { imageDataUrl: _drop, ...rest } = task
  return rest
}

function normalizeStaleActive(task: LocalTask): LocalTask {
  const active =
    task.status === 'waiting' ||
    task.status === 'submitting' ||
    task.status === 'queued' ||
    task.status === 'running'
  if (!active) return task
  return {
    ...task,
    status: 'failed',
    phase: 'failed',
    error: task.error || '上次退出时任务未完成',
    finishedAt: task.finishedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
}

export function listTaskHistory(): LocalTask[] {
  const p = taskHistoryPath()
  if (!existsSync(p)) return []
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as TaskHistoryFile
    const items = Array.isArray(raw.items) ? raw.items : []
    return items.map((t) => normalizeStaleActive(stripHeavyFields(t)))
  } catch {
    return []
  }
}

export function saveTaskHistory(tasks: LocalTask[]): LocalTask[] {
  const cleaned = tasks.map(stripHeavyFields).slice(0, MAX_TASKS)
  const payload: TaskHistoryFile = { version: 1, items: cleaned }
  writeFileSync(taskHistoryPath(), JSON.stringify(payload, null, 2), 'utf8')
  return cleaned
}

export function clearTaskHistory(): void {
  saveTaskHistory([])
}
