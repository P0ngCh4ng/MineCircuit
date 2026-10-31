// 設計図の大きさを変える画面の入力と、枠の取っ手を引いている間の見本（#191・#201、docs/ui.md「設計図の大きさ」）。
// 取っ手を離して消えるブロックがあるときに、引いた値を入れて画面を開けるように、画面の入力をここに置く。

import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { Box } from '../../domain/box'
import type { RegionGrow } from '../../edit/blueprintResize'

/** 枠の取っ手を引いている間の、変えたあとの枠 */
export interface FramePreview {
  readonly box: Box
  /** 縮めて消えるブロックかエンティティがある（赤で出す） */
  readonly removes: boolean
}

export const useBlueprintResizeStore = defineStore('blueprintResize', () => {
  /** 「大きさを変える」の画面を開いている */
  const dialogOpen = ref(false)
  const regionIndex = ref(0)
  /** 負の向き（x−・y−・z−）と正の向き（x+・y+・z+）に足すマス数 */
  const minGrow = ref<[number, number, number]>([0, 0, 0])
  const maxGrow = ref<[number, number, number]>([0, 0, 0])
  /** 枠の取っ手を引いている間の見本。引いていなければ null */
  const preview = shallowRef<FramePreview | null>(null)

  /** 画面を開く。grow を渡すとその値を入れる（初期値は 0） */
  function openDialog(grow?: RegionGrow, region = 0): void {
    regionIndex.value = region
    minGrow.value = grow ? [...grow.min] : [0, 0, 0]
    maxGrow.value = grow ? [...grow.max] : [0, 0, 0]
    dialogOpen.value = true
  }

  function closeDialog(): void {
    dialogOpen.value = false
  }

  function setPreview(next: FramePreview | null): void {
    preview.value = next
  }

  return { dialogOpen, regionIndex, minGrow, maxGrow, preview, openDialog, closeDialog, setPreview }
})
