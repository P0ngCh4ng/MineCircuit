// R / Shift+R で回すもの（docs/ui.md「キー操作」「回す・反転する」）。
// 2つ以上のマスの範囲を選んでいれば、範囲を右回り（Shift なら左回り）に回す（#132）。
// 置くツールのときは置くブロック、それ以外で選択中のブロックがあればそのブロック、なければ置くブロックを回す。
// 回せる向きがなければ「このブロックには回せる向きがありません」と出す。

import { isSingleCell } from '../../domain/box'
import { rotateBlock } from '../../edit/editCommand'
import { useDocumentSession } from '../document/documentSession'
import { NO_ROTATION_MESSAGE, useBrushStore } from '../stores/brushStore'
import { useModpackContentStore } from '../stores/modpackContent'
import { useToolStore } from '../stores/toolStore'
import { placementProblem } from './placementRules'
import { useRegionActions } from './regionActions'

/** 回す処理を返す。部品の setup の中で呼ぶ。回ったら true。overwrite は範囲を回すときにほかのブロックを上書きするか */
export function useRotateAction(): (vertical: boolean, overwrite?: boolean) => boolean {
  const tools = useToolStore()
  const brush = useBrushStore()
  const content = useModpackContentStore()
  const session = useDocumentSession()
  const region = useRegionActions()

  return (vertical, overwrite = false) => {
    const doc = session.current.value
    const box = tools.selectionBox
    if (doc && box && !isSingleCell(box)) return region.rotate(vertical ? 3 : 1, overwrite)
    const pos = tools.selectedPos
    if (tools.activeToolId !== 'place' && doc && pos && doc.blueprint.get(pos)) {
      const cmd = rotateBlock(doc.blueprint, pos, vertical, content.pack)
      // 回した向きがゲームで置けない向きなら回さない（#121）
      const after = cmd?.changes[0]?.after.state
      const problem = after ? placementProblem(doc.blueprint, pos, after) : null
      if (problem) {
        brush.setMessage(problem)
        return false
      }
      const applied = session.apply(cmd)
      brush.setMessage(applied ? null : NO_ROTATION_MESSAGE)
      return applied
    }
    return brush.rotate(vertical)
  }
}
