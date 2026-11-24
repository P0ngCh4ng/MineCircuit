import { describe, expect, it } from 'vitest'
import type { ConnectToolDef } from '../../calc/connectTool'
import { buildToolCatalog, CORE_TOOLS, TOOL_CATALOG } from './toolCatalog'

function connectDef(id: string, key: string | null): ConnectToolDef {
  return {
    id,
    label: id,
    key,
    description: '',
    icon: [],
    messages: { pickStart: '', cancelled: '', first: () => '', done: () => '', command: () => '' },
    canStart: () => false,
    plan: () => null,
  }
}

describe('buildToolCatalog（#266）', () => {
  it('つなぐツールがなければ内蔵のツールだけ', () => {
    expect(buildToolCatalog([]).map((t) => t.id)).toEqual(CORE_TOOLS.map((t) => t.id))
    expect(CORE_TOOLS.map((t): string => t.id)).not.toContain('belt')
  })

  it('計算プラグインのつなぐツールを内蔵のツールのあとに足す', () => {
    const catalog = buildToolCatalog([connectDef('pipe', 'Q')])
    expect(catalog.at(-1)).toMatchObject({ id: 'pipe', key: 'Q' })
  })

  it('id が重なるものは足さず、キーが重なるものはキーなしで足す', () => {
    const catalog = buildToolCatalog([connectDef('place', 'Q'), connectDef('wire', 'b'), connectDef('cable', 'W'), connectDef('rope', 'W')])
    expect(catalog.filter((t) => t.id === 'place')).toHaveLength(1)
    expect(catalog.find((t) => t.id === 'wire')?.key).toBeNull()
    expect(catalog.find((t) => t.id === 'cable')?.key).toBe('W')
    expect(catalog.find((t) => t.id === 'rope')?.key).toBeNull()
  })

  it('内蔵の計算プラグイン（Create）のベルトは L で最後に並ぶ', () => {
    expect(TOOL_CATALOG.at(-1)).toMatchObject({ id: 'belt', label: 'ベルト', key: 'L' })
  })
})
