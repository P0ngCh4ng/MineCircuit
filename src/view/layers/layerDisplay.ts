// 段の表示方法。docs/design.md「view」の ViewState、docs/ui.md「段の一覧」。
// 3D表示（#9）と2D表示（#14）が、どの段をどう描くかをここで決める。
// 段の選択と表示方法の画面は shell/ViewControls.vue と layers/LayerPanel.vue（#10）。

/**
 * 段の表示方法。
 * - all：すべて表示
 * - hideAbove：今の段より上を消す
 * - ghostAbove：今の段より上を半透明にする
 * - only：今の段だけ表示
 */
export type LayerMode = 'all' | 'hideAbove' | 'ghostAbove' | 'only'

/** 表示方法の一覧。画面に出す順 */
export const LAYER_MODES: readonly { readonly id: LayerMode; readonly label: string; readonly title: string }[] = [
  { id: 'all', label: 'すべて', title: 'すべての段を表示する' },
  { id: 'hideAbove', label: '上を消す', title: '今の段より上の段を消す' },
  { id: 'ghostAbove', label: '上を半透明', title: '今の段より上の段を半透明にする' },
  { id: 'only', label: 'この段だけ', title: '今の段だけを表示する' },
]

/** 1つの段の見え方。ghost は半透明で、当たり判定の対象にしない */
export type LayerVisibility = 'solid' | 'ghost' | 'hidden'

export interface LayerDisplay {
  /** 今の段（y、0 始まり） */
  readonly layer: number
  readonly mode: LayerMode
  /** 段の一覧で非表示にした段（y） */
  readonly hidden: ReadonlySet<number>
}

/** すべての段を表示する */
export const SHOW_ALL_LAYERS: LayerDisplay = Object.freeze({ layer: 0, mode: 'all', hidden: new Set<number>() })

/** 段 y の見え方 */
export function layerVisibility(display: LayerDisplay, y: number): LayerVisibility {
  if (display.hidden.has(y)) return 'hidden'
  switch (display.mode) {
    case 'all':
      return 'solid'
    case 'only':
      return y === display.layer ? 'solid' : 'hidden'
    case 'hideAbove':
      return y <= display.layer ? 'solid' : 'hidden'
    case 'ghostAbove':
      return y <= display.layer ? 'solid' : 'ghost'
  }
}
