// 範囲を動かした操作に合わせて、選択範囲と仮の入出力を動かす（docs/design.md「範囲の編集」、#131）。
// どちらも画面の状態なので、履歴には入れず、操作を書いた・元に戻したときの合図（session.onRelocate）で直す。

import { onBeforeUnmount } from 'vue'
import { relocatePos } from '../../edit/regionMove'
import { useDocumentSession } from '../document/documentSession'
import { usePortStore } from '../stores/portStore'
import { useToolStore } from '../stores/toolStore'

/** App の setup の中で1回呼ぶ */
export function useRelocationSync(): void {
  const session = useDocumentSession()
  const tools = useToolStore()
  const ports = usePortStore()

  const disconnect = session.onRelocate.connect(({ relocation, forward }) => {
    const anchor = tools.selectedPos
    tools.setSelectionBox(
      forward ? relocation.target : relocation.source,
      anchor ? relocatePos(relocation, anchor, forward) : undefined,
    )
    ports.relocate((pos) => relocatePos(relocation, pos, forward))
  })
  onBeforeUnmount(disconnect)
}
