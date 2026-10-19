// 3D表示の線や強調の色。画面のテーマ（明るい・暗い）に合わせる。
// 背景は canvas を透明にして、表示部分の CSS の背景をそのまま見せる。

export type ThemeName = 'light' | 'dark'

export interface ViewportTheme {
  readonly name: ThemeName
  /** グリッドの線 */
  readonly grid: number
  /** 今の段の枠 */
  readonly layerFrame: number
  /** 選択中のブロックの枠 */
  readonly selection: number
  /** マウスの下のブロックの枠 */
  readonly hover: number
  /** 光の強さ。暗いテーマでは少し落として、ブロックがまぶしくならないようにする */
  readonly ambient: number
  readonly sun: number
}

export const LIGHT_THEME: ViewportTheme = Object.freeze({
  name: 'light',
  grid: 0xc3bfb4,
  layerFrame: 0xa8741c,
  selection: 0xa8741c,
  hover: 0x3a3936,
  ambient: 0.8,
  sun: 0.7,
})

export const DARK_THEME: ViewportTheme = Object.freeze({
  name: 'dark',
  grid: 0x3a3f41,
  layerFrame: 0xd9a441,
  selection: 0xffc857,
  hover: 0xe6e4de,
  ambient: 0.7,
  sun: 0.6,
})

export function viewportTheme(name: ThemeName): ViewportTheme {
  return name === 'dark' ? DARK_THEME : LIGHT_THEME
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** 今のテーマ。matchMedia がない環境では明るいテーマ */
export function currentThemeName(): ThemeName {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

/** テーマが変わったら fn を呼ぶ。戻り値で受け取りをやめる */
export function watchThemeName(fn: (name: ThemeName) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(DARK_QUERY)
  const listener = () => fn(query.matches ? 'dark' : 'light')
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}
