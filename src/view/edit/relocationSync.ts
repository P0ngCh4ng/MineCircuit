// 範囲を動かす・回す・反転する・貼る操作に合わせて、選択範囲と仮の入出力を動かす（docs/design.md「範囲の編集」、#131〜#133）。
// ブロックを消す操作では、そのブロックに付けた仮の入出力を消し、元に戻すと戻す（#167）。
// どちらも画面の状態なので、履歴には入れず、操作を書いた・元に戻したときの合図（session.onRelocate・onCommand）で直す。

import { onBeforeUnmount } from 'vue'
import { AttachmentLedger } from '../../edit/attachmentLedger'
import { relocatePos } from '../../edit/regionTransform'
import type { VirtualPort } from '../../calc/virtualPort'
import type { Vec3 } from '../../domain/vec3'
import { useDocumentSession } from '../document/documentSession'
import { usePortStore } from '../stores/portStore'
import { useToolStore } from '../stores/toolStore'

/** App の setup の中で1回呼ぶ */
export function useRelocationSync(): void {
  const session = useDocumentSession()
  const tools = useToolStore()
  const ports = usePortStore()

  const disconnect = session.onRelocate.connect(({ relocation, forward }) => {
    // 設計図の大きさを変えた操作（#191）は、選択範囲を置き換えずにずらすだけ
    if (relocation.keepSelection) {
      const box = tools.selectionBox
      const anchor = tools.selectedPos
      if (box) {
        const move = (p: Vec3) => relocatePos(relocation, p, forward)
        tools.setSelectionBox({ min: move(box.min), max: move(box.max) }, anchor ? move(anchor) : undefined)
      }
      ports.relocate((pos) => relocatePos(relocation, pos, forward))
      return
    }
    // 貼り付け（source が null）は、貼った所を選び、元に戻したら選択を解除する（#133）
    const anchor = relocation.source ? tools.selectedPos : null
    tools.setSelectionBox(
      forward ? relocation.target : relocation.source,
      anchor ? relocatePos(relocation, anchor, forward) : undefined,
    )
    ports.relocate((pos) => relocatePos(relocation, pos, forward))
  })

  // 消したブロックの仮の入出力。動かした操作では、位置を動かしたあと（onRelocate のあと）に調べる
  const ledger = new AttachmentLedger<VirtualPort>((p) => p.pos)
  const disconnectCommand = session.onCommand.connect(({ command, forward }) => {
    const relocation = command.relocation
    const next = forward
      ? ledger.applied(command, ports.ports)
      : ledger.undone(command, ports.ports, (p) =>
          relocation ? { ...p, pos: relocatePos(relocation, p.pos, false) } : p,
        )
    if (next !== ports.ports) ports.replaceAll(next)
  })
  onBeforeUnmount(() => {
    disconnect()
    disconnectCommand()
  })
}
