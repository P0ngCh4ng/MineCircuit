import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { createDocumentSession, DOCUMENT_SESSION_KEY } from '../document/documentSession'
import { useHighlightStore } from './highlightStore'
import { useMeasureStore } from './measureStore'
import { useProbeStore } from './probeStore'
import { useSearchStore } from './searchStore'
import { useToolStore } from './toolStore'
import { useProbeTool } from '../calc/useProbeTool'

function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const session = createDocumentSession()
  session.setBlueprint(
    blueprintFixture({ size: [3, 1, 1] }).fill([0, 0, 0], [2, 0, 0], 'create:shaft', { axis: 'x' }).toBlueprint(),
    'sample.nbt',
  )
  let highlight!: ReturnType<typeof useHighlightStore>
  const Host = defineComponent({
    setup() {
      useProbeTool()
      highlight = useHighlightStore()
      return () => h('div')
    },
  })
  mount(Host, { global: { plugins: [pinia], provide: { [DOCUMENT_SESSION_KEY as symbol]: session } } })
  return {
    highlight,
    search: useSearchStore(),
    measures: useMeasureStore(),
    probe: useProbeStore(),
    tools: useToolStore(),
  }
}

describe('highlightStore（#163）', () => {
  it('C でネットワークのツールになり、クリックでネットワークを強調する', () => {
    const { highlight, probe, tools } = setup()
    expect(tools.isAvailable('network')).toBe(true)
    tools.setTool('network')
    tools.click({ pos: [1, 0, 0], empty: false })
    expect(probe.probedPos).toEqual([1, 0, 0])
    expect(highlight.kind).toBe('network')
    // ほかのツールに替えても強調は残る
    tools.setTool('select')
    expect(highlight.kind).toBe('network')
  })

  it('強調は1種類だけ。新しく強調すると前の強調を消す', () => {
    const { highlight, search, measures, probe } = setup()
    search.setHighlight('create:shaft')
    expect(highlight.kind).toBe('search')
    measures.setSameBlockStart([0, 0, 0])
    expect(highlight.kind).toBe('sameBlock')
    expect(search.highlightId).toBeNull()
    probe.setProbed([2, 0, 0])
    expect(highlight.kind).toBe('network')
    expect(measures.sameBlockStart).toBeNull()
    search.setHighlight('create:shaft')
    expect(probe.probedPos).toBeNull()
    expect(highlight.kind).toBe('search')
  })

  it('clearAll ですべての強調を消す（Esc と「強調を解除」）', () => {
    const { highlight, search, probe } = setup()
    expect(highlight.clearAll()).toBe(false)
    probe.setProbed([0, 0, 0])
    expect(highlight.active).toBe(true)
    expect(highlight.clearAll()).toBe(true)
    expect(highlight.active).toBe(false)
    expect(probe.probedPos).toBeNull()
    expect(search.highlightId).toBeNull()
  })
})
