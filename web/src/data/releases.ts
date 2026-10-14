export type ReleaseAsset = {
  name: string
  url: string
  version: string
  size?: number
}

export type ReleasesManifest = {
  tag: string
  publishedAt: string | null
  notes: string
  apps: {
    studio: ReleaseAsset | null
    gateway: ReleaseAsset | null
  }
  sourceUrl: string
}

export const FALLBACK_RELEASES: ReleasesManifest = {
  tag: '',
  publishedAt: null,
  notes: '发布包由 GitHub Releases 提供。若本页尚未同步到资产，请前往仓库下载最新构建。',
  apps: {
    studio: null,
    gateway: null
  },
  sourceUrl: 'https://github.com/mokyarcher/Comfy-Studio/releases'
}
