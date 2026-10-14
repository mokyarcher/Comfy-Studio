/**
 * Fetch latest GitHub Release assets for Studio / Gateway and write src/data/releases.json.
 * Usage: node scripts/sync-releases.mjs
 * Env: GITHUB_TOKEN (optional, higher rate limit), GITHUB_REPO (default mokyarcher/Comfy-Studio)
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outPath = join(root, 'src', 'data', 'releases.json')

const repo = process.env.GITHUB_REPO || 'mokyarcher/Comfy-Studio'
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN

const FALLBACK = {
  tag: '',
  publishedAt: null,
  notes:
    '发布包由 GitHub Releases 提供。若本页尚未同步到资产，请前往仓库下载最新构建。',
  apps: { studio: null, gateway: null },
  sourceUrl: `https://github.com/${repo}/releases`
}

function classifyAsset(name) {
  const lower = name.toLowerCase()
  if (lower.includes('gateway')) return 'gateway'
  if (lower.includes('studio')) return 'studio'
  return null
}

function pickAsset(assets, kind) {
  const matches = assets.filter((a) => classifyAsset(a.name) === kind)
  if (!matches.length) return null
  const preferred =
    matches.find((a) => /\.(exe|zip|7z)$/i.test(a.name)) || matches[0]
  return {
    name: preferred.name,
    url: preferred.browser_download_url,
    version: '',
    size: preferred.size
  }
}

async function main() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'comfy-studio-web-sync'
  }
  if (token) headers.Authorization = `Bearer ${token}`

  let manifest = { ...FALLBACK }

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers
    })
    if (res.status === 404) {
      console.warn('No latest release; writing fallback manifest.')
    } else if (!res.ok) {
      throw new Error(`GitHub API ${res.status}: ${await res.text()}`)
    } else {
      const data = await res.json()
      const tag = data.tag_name || ''
      const studio = pickAsset(data.assets || [], 'studio')
      const gateway = pickAsset(data.assets || [], 'gateway')
      if (studio) studio.version = tag
      if (gateway) gateway.version = tag
      manifest = {
        tag,
        publishedAt: data.published_at || null,
        notes: (data.body || '').slice(0, 800) || FALLBACK.notes,
        apps: { studio, gateway },
        sourceUrl: data.html_url || FALLBACK.sourceUrl
      }
      console.log(`Synced release ${tag}: studio=${!!studio} gateway=${!!gateway}`)
    }
  } catch (err) {
    console.warn('sync-releases failed, keeping fallback:', err.message || err)
    manifest = FALLBACK
  }

  writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  console.log('Wrote', outPath)
}

main()
