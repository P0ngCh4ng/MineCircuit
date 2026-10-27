// 編集のツール（置く・消す・スポイト）を使えるようにする（#18）。docs/ui.md「編集」。
// ツールはストアと DocumentSession を EditToolContext としてまとめて受け取る。

import { isSingleCell } from '../../domain/box'
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
import { orientForPlacement, placementHelper, placementProblem } from './placementRules'
import type { MoveDirection } from '../tools/keymap'
import { moveVector } from './moveDirection'
import { useRegionActions } from './regionActions'

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
      // 1つだけ選んでいたブロックを消したら、選択を外す。2つ以上のマスの範囲なら、範囲は残す
      const bp = session.current.value?.blueprint
      const selected = tools.selectedPos
      const box = tools.selectionBox
      const single = !box || isSingleCell(box)
      if (applied && bp && selected && single && bp.get(selected) === null) tools.setSelected(null)
      return applied
    },
    brush: () => brush.state,
    setBrush: (state) => brush.setFromBlock(state),
    notify: (message) => brush.setMessage(message),
    setHovered: (pos) => tools.setHovered(pos),
    setGhost: (pos, blocked) => brush.setGhost(pos, blocked),
    orient: orientForPlacement,
    placementProblem,
    placementHelper,
    revealLayer(y) {
      if (layerVisibility(view.layerDisplay, y) === 'solid') return
      view.setLayerHidden(y, false)
      layers.setLayer(y)
    },
  }
}

/** useEditTools が返す、キー操作から呼ぶ処理 */
export interface EditKeyActions {
  /** Delete。2つ以上のマスの範囲なら範囲の中を、そうでなければ選択中のブロックを消す。消したら true */
  deleteSelected(): boolean
  /** F。範囲（1マスでもよい）の空きを置くブロックで塗る。塗ったら true */
  fillSelection(): boolean
  /** Ctrl+A。設計図全体を選ぶ */
  selectAll(): void
  /** 矢印キー・Shift+PageUp / PageDown。範囲を1マス動かす。Ctrl なら上書き。動かしたら true */
  moveSelection(direction: MoveDirection, overwrite: boolean): boolean
}

/**
 * 置く・消す・スポイトのツールを登録し、範囲の操作を含むキー操作の処理を返す（docs/ui.md「キー操作」）。
 * App の setup で1回呼ぶ
 */
export function useEditTools(): EditKeyActions {
  const ctx = useEditToolContext()
  const tools = useToolStore()
  const session = useDocumentSession()
  const region = useRegionActions()
  const view = useViewStore()

  tools.register(new PlaceTool(ctx))
  tools.register(new EraseTool(ctx))
  tools.register(new PickTool(ctx))

  return {
    deleteSelected() {
      const box = tools.selectionBox
      if (box && !isSingleCell(box)) return region.erase()
      const bp = session.current.value?.blueprint
      const pos = tools.selectedPos
      if (!bp || !pos) return false
      return ctx.apply(eraseBlock(bp, pos))
    },
    fillSelection() {
      if (!session.current.value || !tools.selectionBox) return false
      // パネルの「空きだけ」の初期値と同じく、空きだけを塗る。置くブロックがないときは、region が状態表示に理由を出す
      return region.fill(true)
    },
    selectAll() {
      if (!session.current.value) return
      region.selectAll()
    },
    moveSelection(direction, overwrite) {
      if (!session.current.value) return false
      return region.move(moveVector(direction, view.mode, view.getCameraHeading()), overwrite)
    },
  }
}
