// R / Shift+R で回すもの（docs/ui.md「キー操作」）。
// 置くツールのときは置くブロック、それ以外で選択中のブロックがあればそのブロック、なければ置くブロックを回す。
// 回せる向きがなければ「このブロックには回せる向きがありません」と出す。

import { rotateBlock } from '../../edit/editCommand'
import { useDocumentSession } from '../document/documentSession'
import { NO_ROTATION_MESSAGE, useBrushStore } from '../stores/brushStore'
import { useModpackContentStore } from '../stores/modpackContent'
import { useToolStore } from '../stores/toolStore'

/** 回す処理を返す。部品の setup の中で呼ぶ。回ったら true */
export function useRotateAction(): (vertical: boolean) => boolean {
  const tools = useToolStore()
  const brush = useBrushStore()
  const content = useModpackContentStore()
  const session = useDocumentSession()

  return (vertical) => {
    const doc = session.current.value
    const pos = tools.selectedPos
    if (tools.activeToolId !== 'place' && doc && pos && doc.blueprint.get(pos)) {
      const applied = session.apply(rotateBlock(doc.blueprint, pos, vertical, content.pack))
      brush.setMessage(applied ? null : NO_ROTATION_MESSAGE)
      return applied
    }
    return brush.rotate(vertical)
  }
}
