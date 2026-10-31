// 範囲をマウスでつかんで動かしている間の見本（#199、docs/ui.md「動かす」）。
// 画面の状態なので履歴には入れない。3D・2D表示が貼り付けの見本と同じ形で描く。

import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import type { MovePreview } from '../edit/dragMove'

export const useDragMoveStore = defineStore('dragMove', () => {
  /** 行き先の見本。動かしていなければ null */
  const preview = shallowRef<MovePreview | null>(null)

  function setPreview(next: MovePreview | null): void {
    preview.value = next
  }

  return { preview, setPreview }
})
