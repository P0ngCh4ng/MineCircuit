// 編集のツール（置く・消す・スポイト）を使えるようにする（#18）。docs/ui.md「編集」。
// ツールはストアと DocumentSession を EditToolContext としてまとめて受け取る。

import { eraseBlock } from '../../edit/editCommand'
import { useDocumentSession } from '../document/documentSession'
import { layerVisibility } from '../layers/layerDisplay'
import { useBrushStore } from '../stores/brushStore'
import { useLayerStore } from '../stores/layerStore'
import { useToolStore } from '../stores/toolStore'
import { useViewStore } from '../stores/viewStore'
import type { EditToolContext } from '../tools/editToolContext'
import { EraseTool } from '../tools/eraseTool'
import { PickTool } from '../tools/pickTool'
import { PlaceTool } from '../tools/placeTool'

/** 画面のストアと DocumentSession から EditToolContext を作る。部品の setup の中で呼ぶ */
export function useEditToolContext(): EditToolContext {
  const session = useDocumentSession()
  const tools = useToolStore()
  const brush = useBrushStore()
  const view = useViewStore()
  const layers = useLayerStore()

  return {
    blueprint: () => session.current.value?.blueprint ?? null,
    apply(cmd) {
      const applied = session.apply(cmd)
      // 選択中のブロックを消したら、選択を外す
      const bp = session.current.value?.blueprint
      const selected = tools.selectedPos
      if (applied && bp && selected && bp.get(selected) === null) tools.setSelected(null)
      return applied
    },
    brush: () => brush.state,
    setBrush: (state) => brush.setFromBlock(state),
    notify: (message) => brush.setMessage(message),
    setHovered: (pos) => tools.setHovered(pos),
    setGhost: (pos) => brush.setGhost(pos),
    revealLayer(y) {
      if (layerVisibility(view.layerDisplay, y) === 'solid') return
      view.setLayerHidden(y, false)
      layers.setLayer(y)
    },
  }
}

/**
 * 置く・消す・スポイトのツールを登録し、Delete キーの処理を返す。App の setup で1回呼ぶ。
 * 戻り値の deleteSelected は、選択中のブロックを消す。消したら true
 */
export function useEditTools(): { deleteSelected: () => boolean } {
  const ctx = useEditToolContext()
  const tools = useToolStore()
  const session = useDocumentSession()

  tools.register(new PlaceTool(ctx))
  tools.register(new EraseTool(ctx))
  tools.register(new PickTool(ctx))

  return {
    deleteSelected() {
      const bp = session.current.value?.blueprint
      const pos = tools.selectedPos
      if (!bp || !pos) return false
      return ctx.apply(eraseBlock(bp, pos))
    },
  }
}
