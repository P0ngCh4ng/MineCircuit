// 選択範囲の取っ手を引いて広げる・縮める口（#200、docs/ui.md「範囲を選ぶ」）。3D・2D表示が呼ぶ。
// 範囲の選び直しは編集ではないので、履歴には入れずに選択範囲だけを変える。

import { boxContains, type Box } from '../../domain/box'
import { useDocumentSession } from '../document/documentSession'
import { useBrushStore } from '../stores/brushStore'
import { useToolStore } from '../stores/toolStore'
import { moveFaces, rangeSizeLabel, type FaceHandle } from './rangeHandles'

export interface RangeResize {
  /** 取っ手をつかむ。範囲がなければ false */
  begin(faces: readonly FaceHandle[]): boolean
  /** 引いている間。boundary はつかんだ面を動かす先のマスの境目（小数でよい） */
  update(boundary: (axis: 0 | 1 | 2) => number): void
  /** 離す・やめる */
  end(): void
  readonly active: boolean
}

/** 部品の setup の中で呼ぶ */
export function useRangeResize(): RangeResize {
  const session = useDocumentSession()
  const tools = useToolStore()
  const brush = useBrushStore()
  let grabbed: { readonly box: Box; readonly faces: readonly FaceHandle[] } | null = null

  return {
    begin(faces) {
      const box = tools.selectionBox
      if (!session.current.value || !box) return false
      grabbed = { box, faces }
      brush.setMessage(rangeSizeLabel(box))
      return true
    },
    update(boundary) {
      const bp = session.current.value?.blueprint
      if (!bp || !grabbed) return
      const next = moveFaces(grabbed.box, grabbed.faces, boundary, bp.size)
      // 起点（Shift+クリックで広げる元）は、新しい範囲に入っていればそのまま
      const anchor = tools.selectedPos && boxContains(next, tools.selectedPos) ? tools.selectedPos : next.min
      tools.setSelectionBox(next, anchor)
      brush.setMessage(rangeSizeLabel(next))
    },
    end() {
      if (!grabbed) return
      grabbed = null
      brush.setMessage(null)
    },
    get active() {
      return grabbed !== null
    },
  }
}
