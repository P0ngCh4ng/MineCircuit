// 今の段の移動（▲▼、PageUp / PageDown、段の一覧のクリック）。docs/ui.md「段の一覧」「キー操作」。
// 値は layerStore（useLayerStore().current）が持つ。ここでは開いている設計図の高さに収めて動かす。

import { computed, type ComputedRef } from 'vue'
import { useDocumentSession } from '../document/documentSession'
import { clampLayer, useLayerStore } from '../stores/layerStore'

export interface LayerNavigation {
  /** 設計図の高さ（段の数）。開いていなければ 0 */
  readonly height: ComputedRef<number>
  /** 今の段の y（0 始まり）。設計図の高さに収めた値 */
  readonly current: ComputedRef<number>
  readonly canUp: ComputedRef<boolean>
  readonly canDown: ComputedRef<boolean>
  /** 段 y を今の段にする。範囲外なら端の段にする */
  select(y: number): void
  /** 1つ上の段へ */
  up(): void
  /** 1つ下の段へ */
  down(): void
}

/** 部品の setup の中で呼ぶ */
export function useLayerNavigation(): LayerNavigation {
  const session = useDocumentSession()
  const layers = useLayerStore()

  const height = computed(() => session.current.value?.blueprint.size[1] ?? 0)
  const current = computed(() => clampLayer(layers.current, height.value))
  const canUp = computed(() => current.value < height.value - 1)
  const canDown = computed(() => height.value > 0 && current.value > 0)

  function select(y: number): void {
    if (height.value === 0) return
    layers.setLayer(clampLayer(y, height.value))
  }

  return {
    height,
    current,
    canUp,
    canDown,
    select,
    up: () => select(current.value + 1),
    down: () => select(current.value - 1),
  }
}
