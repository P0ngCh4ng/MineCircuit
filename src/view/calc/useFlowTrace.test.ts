import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyResult } from '../../calc/calcPlugin'
import { boxFromCorners } from '../../domain/box'
import { useCalcStore } from '../stores/calcStore'
import { useToolStore } from '../stores/toolStore'
import { useViewStore } from '../stores/viewStore'
import { useFlowTrace } from './useFlowTrace'

describe('useFlowTrace（#207）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useCalcStore().outcomes = [
      {
        pluginId: 'create-stress',
        label: 'Create の応力',
        status: 'ok',
        result: { ...emptyResult(), links: [{ from: [0, 0, 0], to: [1, 0, 0], kind: 'power' }], sources: [[0, 0, 0]] },
      },
    ]
  })

  it('「回転」を入れて、ブロックを1つ選んでいるときだけ出す', () => {
    const trace = useFlowTrace()
    const tools = useToolStore()
    const view = useViewStore()
    tools.setSelected([1, 0, 0])
    expect(trace.value).toBeNull()
    view.showRotation = true
    expect(trace.value?.arrows).toEqual([{ from: [0, 0, 0], to: [1, 0, 0], kind: 'power' }])
    tools.setSelectionBox(boxFromCorners([0, 0, 0], [1, 0, 0]), [1, 0, 0])
    expect(trace.value).toBeNull()
    tools.setSelected(null)
    expect(trace.value).toBeNull()
  })
})
