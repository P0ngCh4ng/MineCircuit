// ブロックの仮の色。テクスチャはアプリに入れないので（CLAUDE.md「データと権利のルール」）、
// ブロックの ID から決まった色を作る。同じ ID はいつも同じ色になる。
// 3D表示・2D表示・ブロック一覧の色見本で同じ色を使う。

/** 文字列のハッシュ（FNV-1a、32ビット） */
function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** HSL（h は度、s・l は 0〜1）を 0xRRGGBB にする */
export function hslToHex(h: number, s: number, l: number): number {
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number): number => {
    const k = (n + h / 30) % 12
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(v * 255)
  }
  return (channel(0) << 16) | (channel(8) << 8) | channel(4)
}

const cache = new Map<string, number>()

/**
 * ブロックの ID（"create:shaft"）から仮の色を 0xRRGGBB で返す。
 * 彩度と明るさは中くらいに抑え、明るい背景でも暗い背景でも見えるようにする。
 */
export function blockColor(id: string): number {
  const cached = cache.get(id)
  if (cached !== undefined) return cached
  const h = hashString(id)
  const hue = h % 360
  const saturation = 0.28 + ((h >>> 9) % 30) / 100
  const lightness = 0.46 + ((h >>> 17) % 18) / 100
  const color = hslToHex(hue, saturation, lightness)
  cache.set(id, color)
  return color
}

/** blockColor を CSS の色（"#rrggbb"）で返す */
export function blockColorCss(id: string): string {
  return `#${blockColor(id).toString(16).padStart(6, '0')}`
}
