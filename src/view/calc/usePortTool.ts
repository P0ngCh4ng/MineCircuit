// 仮の入出力のツールを使えるようにする（#70）。

import { watch } from 'vue'
import { useDocumentSession } from '../document/documentSession'
import { usePortStore } from '../stores/portStore'
import { useToolStore } from '../stores/toolStore'
import { PortTool } from '../tools/portTool'

/** 仮の入出力のツールを登録する。App の setup で1回呼ぶ */
export function usePortTool(): void {
  const tools = useToolStore()
  const ports = usePortStore()
  const session = useDocumentSession()

  tools.register(
    new PortTool({
      setHovered: (pos) => tools.setHovered(pos),
      place: (pos) => void ports.place(pos),
      deselect: () => ports.select(null),
    }),
  )

  // 仮の入出力は開いている設計図1つ分だけ持つ。別の設計図を開いたら消す
  watch(session.current, () => ports.clear())
}
