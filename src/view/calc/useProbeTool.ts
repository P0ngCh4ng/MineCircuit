// プローブとネットワーク（C。#163）のツールを使えるようにし、問題の一覧から位置へ移る処理を作る（#31）。

import { watch } from 'vue'
import type { Vec3 } from '../../domain/vec3'
import { useDocumentSession } from '../document/documentSession'
import { useLayerStore } from '../stores/layerStore'
import { useProbeStore } from '../stores/probeStore'
import { useToolStore } from '../stores/toolStore'
import { useViewStore } from '../stores/viewStore'
import { NetworkTool } from '../tools/networkTool'
import { ProbeTool } from '../tools/probeTool'

/** プローブとネットワークのツールを登録する。App の setup で1回呼ぶ */
export function useProbeTool(): void {
  const tools = useToolStore()
  const probe = useProbeStore()
  const session = useDocumentSession()

  tools.register(
    new ProbeTool({
      setHovered(pos) {
        tools.setHovered(pos)
        probe.setHovered(pos)
      },
      setProbed: (pos) => probe.setProbed(pos),
    }),
  )
  tools.register(new NetworkTool({ setProbed: (pos) => probe.setProbed(pos) }))

  // 別の設計図を開いたら、前の設計図の強調を消す
  watch(session.current, () => probe.clear())
}

/**
 * 問題の一覧などから、その位置へ移る関数を返す。部品の setup の中で呼ぶ。
 * ブロックを選択し、その段へ移って（隠していれば表示して）、そのブロックのネットワークを強調する
 */
export function useJumpTo(): (pos: Vec3) => void {
  const tools = useToolStore()
  const probe = useProbeStore()
  const layers = useLayerStore()
  const view = useViewStore()
  return (pos) => {
    tools.setSelected(pos)
    probe.setProbed(pos)
    view.setLayerHidden(pos[1], false)
    layers.setLayer(pos[1])
  }
}
