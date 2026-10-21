// 仮の入出力のツールを使えるようにする（#70）。

import { watch } from 'vue'
import { useDocumentSession } from '../document/documentSession'
import { usePortStore } from '../stores/portStore'
import { useToolStore } from '../stores/toolStore'
import { PortTool } from '../tools/portTool'
import { defaultPortFace } from './portModel'

/** 仮の入出力のツールを登録する。App の setup で1回呼ぶ */
export function usePortTool(): void {
  const tools = useToolStore()
  const ports = usePortStore()
  const session = useDocumentSession()

  tools.register(
    new PortTool({
      setHovered: (pos) => tools.setHovered(pos),
      defaultFace(pos) {
        const bp = session.current.value?.blueprint
        return bp ? defaultPortFace(bp, pos) : 'up'
      },
      place: (pos, face) => void ports.place(pos, face),
      deselect: () => ports.select(null),
    }),
  )

  // 仮の入出力は開いている設計図1つ分だけ持つ。別の設計図を開いたら消す
  watch(session.current, () => ports.clear())
}
