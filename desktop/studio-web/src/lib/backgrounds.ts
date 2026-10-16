export type BgGroup = 'nature' | 'scene'

export type BackgroundOption = {
  id: string
  label: string
  group: BgGroup
  /** Full-resolution workspace photo */
  url: string
  /** Small preview for instant first paint */
  previewUrl: string
}

/** Static catalog served from /public/backgrounds. */
export const BACKGROUNDS: BackgroundOption[] = [
  {
    id: 'nature-alps-lake',
    label: '湖光山色',
    group: 'nature',
    url: '/backgrounds/chiemseherin-landscape-4587079.jpg',
    previewUrl: '/backgrounds/preview/chiemseherin-landscape-4587079.jpg'
  },
  {
    id: 'nature-sunset',
    label: '晚霞',
    group: 'nature',
    url: '/backgrounds/chiemseherin-sunset-8516639.jpg',
    previewUrl: '/backgrounds/preview/chiemseherin-sunset-8516639.jpg'
  },
  {
    id: 'nature-meadow',
    label: '草甸',
    group: 'nature',
    url: '/backgrounds/jplenio-nature-3125912.jpg',
    previewUrl: '/backgrounds/preview/jplenio-nature-3125912.jpg'
  },
  {
    id: 'nature-cloud-sea',
    label: '云海雪林',
    group: 'nature',
    url: '/backgrounds/franz26-mountains-5868127.jpg',
    previewUrl: '/backgrounds/preview/franz26-mountains-5868127.jpg'
  },
  {
    id: 'nature-aurora',
    label: '极光海湾',
    group: 'nature',
    url: '/backgrounds/gdmoonkiller-sea-7423274.jpg',
    previewUrl: '/backgrounds/preview/gdmoonkiller-sea-7423274.jpg'
  },
  {
    id: 'nature-mirror-lake',
    label: '镜湖森林',
    group: 'nature',
    url: '/backgrounds/12019-lake-1679708.jpg',
    previewUrl: '/backgrounds/preview/12019-lake-1679708.jpg'
  },
  {
    id: 'nature-autumn-ridge',
    label: '秋岭',
    group: 'nature',
    url: '/backgrounds/16208275-autumn-5092804.jpg',
    previewUrl: '/backgrounds/preview/16208275-autumn-5092804.jpg'
  },
  {
    id: 'nature-sunrise-beach',
    label: '日出海岸',
    group: 'nature',
    url: '/backgrounds/sunrise-beach-01.jpg',
    previewUrl: '/backgrounds/preview/sunrise-beach-01.jpg'
  },
  {
    id: 'nature-twin-bridges',
    label: '双桥夜色',
    group: 'nature',
    url: '/backgrounds/leino194-bridge-7504605.jpg',
    previewUrl: '/backgrounds/preview/leino194-bridge-7504605.jpg'
  },
  {
    id: 'nature-fuji',
    label: '富士远望',
    group: 'nature',
    url: '/backgrounds/loitran97-majestic-mount-fuji-9672541.jpg',
    previewUrl: '/backgrounds/preview/loitran97-majestic-mount-fuji-9672541.jpg'
  },
  {
    id: 'nature-way',
    label: '山径',
    group: 'nature',
    url: '/backgrounds/marcinz83-way-7642285.jpg',
    previewUrl: '/backgrounds/preview/marcinz83-way-7642285.jpg'
  },
  {
    id: 'scene-bmw-m4',
    label: '灰影 M4',
    group: 'scene',
    url: '/backgrounds/m4-g82-front.jpg',
    previewUrl: '/backgrounds/preview/m4-g82-front.jpg'
  },
  {
    id: 'nature-golden-peaks',
    label: '金晖雪峰',
    group: 'nature',
    url: '/backgrounds/golden-peaks-wallpaper.jpg',
    previewUrl: '/backgrounds/preview/golden-peaks-wallpaper.jpg'
  },
  {
    id: 'scene-m4-gt3',
    label: 'M4 GT3',
    group: 'scene',
    url: '/backgrounds/bmw-m4-gt3-evo.jpg',
    previewUrl: '/backgrounds/preview/bmw-m4-gt3-evo.jpg'
  },
  {
    id: 'scene-sky-lounge',
    label: '云端客厅',
    group: 'scene',
    url: '/backgrounds/sky-lounge-clouds.jpg',
    previewUrl: '/backgrounds/preview/sky-lounge-clouds.jpg'
  },
  {
    id: 'nature-spectacular',
    label: '壮阔山河',
    group: 'nature',
    url: '/backgrounds/spectacular-nature-landscape.jpg',
    previewUrl: '/backgrounds/preview/spectacular-nature-landscape.jpg'
  },
  {
    id: 'nature-wallhaven',
    label: '壁纸山景',
    group: 'nature',
    url: '/backgrounds/wallhaven-ey82ql.jpg',
    previewUrl: '/backgrounds/preview/wallhaven-ey82ql.jpg'
  },
  {
    id: 'scene-00014',
    label: '幻境 014',
    group: 'scene',
    url: '/backgrounds/scene-00014.jpg',
    previewUrl: '/backgrounds/preview/scene-00014.jpg'
  },
  {
    id: 'scene-00056',
    label: '幻境 056',
    group: 'scene',
    url: '/backgrounds/scene-00056.jpg',
    previewUrl: '/backgrounds/preview/scene-00056.jpg'
  },
  {
    id: 'nature-uhdpaper',
    label: '澄空远山',
    group: 'nature',
    url: '/backgrounds/uhdpaper-656.jpg',
    previewUrl: '/backgrounds/preview/uhdpaper-656.jpg'
  },
  {
    id: 'nature-bridge-mist',
    label: '雾桥夜色',
    group: 'nature',
    url: '/backgrounds/bridge-mist-night.jpg',
    previewUrl: '/backgrounds/preview/bridge-mist-night.jpg'
  }
]

export const DEFAULT_BACKGROUND_ID = 'nature-alps-lake'

export const BACKGROUND_PAGE_SIZE = 5

const readyUrls = new Set<string>()
const pending = new Map<string, Promise<void>>()

export function getBackground(id: string | undefined | null): BackgroundOption {
  return BACKGROUNDS.find((b) => b.id === id) ?? BACKGROUNDS[0]!
}

export function backgroundCssUrl(id: string | undefined | null): string {
  return `url('${getBackground(id).url}')`
}

export function isBackgroundReady(id: string | undefined | null): boolean {
  return readyUrls.has(getBackground(id).url)
}

/** Warm browser cache for a full-resolution background. */
export function preloadBackground(id: string | undefined | null): Promise<void> {
  const bg = getBackground(id)
  if (readyUrls.has(bg.url)) return Promise.resolve()
  const existing = pending.get(bg.url)
  if (existing) return existing

  const task = new Promise<void>((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    const done = () => {
      readyUrls.add(bg.url)
      pending.delete(bg.url)
      resolve()
    }
    img.onload = done
    img.onerror = done
    img.src = bg.url
  })
  pending.set(bg.url, task)
  return task
}

/**
 * @deprecated Prefer preloadBackground(currentId) only — catalog is large.
 * Kept as a no-op-safe helper that only warms the given id.
 */
export function preloadAllBackgrounds(preferredId?: string | null): void {
  void preloadBackground(preferredId ?? DEFAULT_BACKGROUND_ID)
}
