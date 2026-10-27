// 選択範囲の一括操作を、画面（キー操作と右パネル）から呼ぶ口（#130）。
// docs/ui.md「範囲の選択と一括操作」。中身は edit/regionEdit.ts の操作を作り、DocumentSession に渡す。

import type { BlockState } from '../../domain/blockState'
import type { Box } from '../../domain/box'
import type { Blueprint } from '../../domain/blueprint'
import type { EditCommand } from '../../edit/editCommand'
import type { Vec3 } from '../../domain/vec3'
import { eraseRegion, fillRegion, replaceInRegion } from '../../edit/regionEdit'
import { moveRegion } from '../../edit/regionMove'
import { useDocumentSession } from '../document/documentSession'
import { useBrushStore } from '../stores/brushStore'
import { useToolStore } from '../stores/toolStore'

export interface RegionActions {
  /** 範囲の中を消す。消したら true */
  erase(): boolean
  /** 範囲を置くブロックで塗る。塗ったら true */
  fill(onlyEmpty: boolean): boolean
  /** 範囲の中の from を置くブロックにする。変えたら true */
  replace(from: BlockState, keepOrientation: boolean): boolean
  /**
   * 範囲を d だけ動かす。overwrite なら行き先のブロックを上書きする。動かしたら true。
   * 選択範囲と仮の入出力は、session.onRelocate を受けて一緒に動く（relocationSync.ts）
   */
  move(d: Vec3, overwrite: boolean): boolean
  /** 設計図全体を選ぶ */
  selectAll(): void
}

/** 状態表示に出す知らせ */
export const REGION_MESSAGES = {
  noBlueprint: '設計図を開いてください',
  noSelection: '範囲を選んでください（選択ツールで Shift+クリック、2D でドラッグ、Ctrl+A で全体）',
  noBrush: '置くブロックを選んでください（左パネルの棚か、スポイト）',
  nothingToErase: '範囲の中にブロックがありません',
  noEmptyCell: '範囲の中に空きマスがありません',
  nothingToFill: '範囲はもう置くブロックで埋まっています',
  nothingToReplace: '範囲の中に置き換えるブロックがありません',
} as const

/** 部品の setup の中で呼ぶ */
export function useRegionActions(): RegionActions {
  const session = useDocumentSession()
  const tools = useToolStore()
  const brush = useBrushStore()

  // 範囲の操作を作って書き込む。範囲はそのまま残す（selectedPos を消すと範囲も消えるので、session に直接渡す）
  function run(make: (bp: Blueprint, box: Box) => EditCommand | null | string, emptyMessage: string): boolean {
    const bp = session.current.value?.blueprint
    if (!bp) {
      brush.setMessage(REGION_MESSAGES.noBlueprint)
      return false
    }
    const box = tools.selectionBox
    if (!box) {
      brush.setMessage(REGION_MESSAGES.noSelection)
      return false
    }
    const cmd = make(bp, box)
    if (typeof cmd === 'string') {
      brush.setMessage(cmd)
      return false
    }
    if (!session.apply(cmd)) {
      brush.setMessage(emptyMessage)
      return false
    }
    brush.setMessage(null)
    return true
  }

  return {
    erase: () => run((bp, box) => eraseRegion(bp, box), REGION_MESSAGES.nothingToErase),
    fill(onlyEmpty) {
      return run(
        (bp, box) => (brush.state ? fillRegion(bp, box, brush.state, onlyEmpty) : REGION_MESSAGES.noBrush),
        onlyEmpty ? REGION_MESSAGES.noEmptyCell : REGION_MESSAGES.nothingToFill,
      )
    },
    replace(from, keepOrientation) {
      return run(
        (bp, box) => (brush.state ? replaceInRegion(bp, box, from, brush.state, keepOrientation) : REGION_MESSAGES.noBrush),
        REGION_MESSAGES.nothingToReplace,
      )
    },
    move(d, overwrite) {
      let warning: string | null = null
      const moved = run((bp, box) => {
        const result = moveRegion(bp, box, d, { overwrite })
        if (!result.ok) return result.reason
        warning = result.warnings[0] ?? null
        return result.command
      }, REGION_MESSAGES.noSelection)
      if (moved && warning) brush.setMessage(warning)
      return moved
    },
    selectAll() {
      const bp = session.current.value?.blueprint
      if (!bp) return
      const [sx, sy, sz] = bp.size
      if (sx < 1 || sy < 1 || sz < 1) return
      tools.setSelectionBox({ min: [0, 0, 0], max: [sx - 1, sy - 1, sz - 1] })
    },
  }
}
