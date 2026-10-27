// 範囲を動かす・回す・反転する・貼る操作に合わせて、選択範囲と仮の入出力を動かす（docs/design.md「範囲の編集」、#131〜#133）。
// どちらも画面の状態なので、履歴には入れず、操作を書いた・元に戻したときの合図（session.onRelocate）で直す。

import { onBeforeUnmount } from 'vue'
import { relocatePlace, relocatePos } from '../../edit/regionTransform'
import { useDocumentSession } from '../document/documentSession'
import { usePortStore } from '../stores/portStore'
import { useToolStore } from '../stores/toolStore'

/** App の setup の中で1回呼ぶ */
export function useRelocationSync(): void {
  const session = useDocumentSession()
  const tools = useToolStore()
  const ports = usePortStore()

  const disconnect = session.onRelocate.connect(({ relocation, forward }) => {
    // 貼り付け（source が null）は、貼った所を選び、元に戻したら選択を解除する（#133）
    const anchor = relocation.source ? tools.selectedPos : null
    tools.setSelectionBox(
      forward ? relocation.target : relocation.source,
      anchor ? relocatePos(relocation, anchor, forward) : undefined,
    )
    ports.relocate((place) => relocatePlace(relocation, place, forward))
  })
  onBeforeUnmount(disconnect)
}
