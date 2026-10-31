// ダブルクリックで、そのブロックから隣り合うブロックをまとめて囲む範囲を選ぶ（#205、docs/ui.md「範囲を選ぶ」）。
// 3D・2D表示が呼ぶ。範囲の選び直しなので履歴には入れない。

import { boxSize } from '../../domain/box'
import type { Vec3 } from '../../domain/vec3'
import { boundingBoxOf, floodConnected } from '../../analysis/floodSameState'
import { useDocumentSession } from '../document/documentSession'
import { useBrushStore } from '../stores/brushStore'
import { useToolStore } from '../stores/toolStore'

/** 部品の setup の中で呼ぶ。返す関数は、選んだら true（空きマス・設計図がないときは false） */
export function useSelectConnected(): (pos: Vec3) => boolean {
  const session = useDocumentSession()
  const tools = useToolStore()
  const brush = useBrushStore()
  return (pos) => {
    const bp = session.current.value?.blueprint
    if (!bp) return false
    const found = floodConnected(bp, pos)
    const box = boundingBoxOf(found)
    if (!box) return false
    tools.setSelectionBox(box, pos)
    brush.setMessage(`つながったブロック ${found.length} 個を選びました（範囲 ${boxSize(box).join(' × ')}）`)
    return true
  }
}
