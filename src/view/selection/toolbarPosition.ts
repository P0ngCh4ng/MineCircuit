// 範囲のツールバー（#160）を置く位置の計算。docs/ui.md「範囲のツールバー」。
// Vue にも canvas にも依存しないので、2D と 3D の両方から使い、表示なしでテストできる。

/** 表示部分の中の長方形（CSS ピクセル。左上が 0） */
export interface ScreenRect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** 範囲とツールバーの間、表示部分の端との間（px） */
export const TOOLBAR_GAP = 8

/**
 * ツールバーの左上の位置。範囲の上に、範囲の右端にそろえて置く。上に入らなければ範囲の下に置く。
 * 表示部分（viewWidth × viewHeight）の外にはみ出すときは内側に寄せる
 */
export function toolbarPosition(
  rect: ScreenRect,
  width: number,
  height: number,
  viewWidth: number,
  viewHeight: number,
): { left: number; top: number } {
  const g = TOOLBAR_GAP
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, Math.max(min, max)))
  const left = clamp(rect.right - width, g, viewWidth - width - g)
  const above = rect.top - height - g
  const top = above >= g ? above : clamp(rect.bottom + g, g, viewHeight - height - g)
  return { left, top }
}

/** 点の集まりを囲む長方形。点がなければ null */
export function boundingRect(points: readonly (readonly [number, number])[]): ScreenRect | null {
  if (points.length === 0) return null
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const [x, y] of points) {
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  }
  return { left, top, right, bottom }
}

/** 2つの長方形が同じなら true（位置が変わらないときに描き直さない） */
export function sameRect(a: ScreenRect | null, b: ScreenRect | null): boolean {
  if (a === null || b === null) return a === b
  return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom
}
