export type BgGroup = 'nature'

export type BackgroundOption = {
  id: string
  label: string
  group: BgGroup
  url: string
}

/** Static catalog served from /public/backgrounds (copied as-is, no build compression). */
export const BACKGROUNDS: BackgroundOption[] = [
  {
    id: 'nature-alps-lake',
    label: '湖光山色',
    group: 'nature',
    url: '/backgrounds/chiemseherin-landscape-4587079.jpg'
  },
  {
    id: 'nature-sunset',
    label: '晚霞',
    group: 'nature',
    url: '/backgrounds/chiemseherin-sunset-8516639.jpg'
  },
  {
    id: 'nature-meadow',
    label: '草甸',
    group: 'nature',
    url: '/backgrounds/jplenio-nature-3125912.jpg'
  }
]

export const DEFAULT_BACKGROUND_ID = 'nature-alps-lake'

export function getBackground(id: string | undefined | null): BackgroundOption {
  return BACKGROUNDS.find((b) => b.id === id) ?? BACKGROUNDS[0]!
}

export function backgroundCssUrl(id: string | undefined | null): string {
  return `url('${getBackground(id).url}')`
}
