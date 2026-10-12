import type { LogLine, LogSource } from '../shared/types'
import { redactSecrets } from '../shared/redact'

const MAX_LINES = 2000

export class RingLogBuffer {
  private lines: LogLine[] = []
  private nextId = 1

  append(source: LogSource, stream: LogLine['stream'], text: string): void {
    const cleaned = redactSecrets(text.replace(/\r/g, ''))
    const chunks = cleaned.split('\n')
    for (const chunk of chunks) {
      if (!chunk) continue
      this.lines.push({
        id: this.nextId++,
        ts: new Date().toISOString(),
        source,
        stream,
        text: chunk
      })
    }
    if (this.lines.length > MAX_LINES) {
      this.lines = this.lines.slice(this.lines.length - MAX_LINES)
    }
  }

  get(source?: LogSource, limit = 500): LogLine[] {
    const filtered = source ? this.lines.filter((l) => l.source === source) : this.lines
    return filtered.slice(-limit)
  }

  clear(source?: LogSource): void {
    if (!source) {
      this.lines = []
      return
    }
    this.lines = this.lines.filter((l) => l.source !== source)
  }
}
