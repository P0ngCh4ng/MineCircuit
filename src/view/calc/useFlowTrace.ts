// 選んだブロックから出す力の流れ（#207、docs/ui.md「力の流れ」）。2D・3D の表示が使う。
// 「回転」を入れていて、ブロックを1つだけ選んでいるときだけ出す。

import { computed, type ComputedRef } from 'vue'
import { traceFlow, type FlowTrace } from '../../calc/flowTrace'
import { isSingleCell } from '../../domain/box'
import { useCalcStore } from '../stores/calcStore'
import { useToolStore } from '../stores/toolStore'
import { useViewStore } from '../stores/viewStore'

/** 部品の setup の中で呼ぶ。出さないときは null */
export function useFlowTrace(): ComputedRef<FlowTrace | null> {
  const calc = useCalcStore()
  const tools = useToolStore()
  const view = useViewStore()
  return computed(() => {
    const pos = tools.selectedPos
    const box = tools.selectionBox
    if (!view.showRotation || !pos || !box || !isSingleCell(box)) return null
    for (const o of calc.outcomes ?? []) {
      if (o.status !== 'ok' || !o.result.links) continue
      const trace = traceFlow(o.result.links, o.result.sources ?? [], pos)
      if (trace) return trace
    }
    return null
  })
}
