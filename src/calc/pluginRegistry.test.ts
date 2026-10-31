import { describe, expect, it } from 'vitest'
import { blueprintFixture } from '../../tests/fixtures/blueprintFixture'
import { NOOP_PLUGIN_ID, noopCalcPlugin } from '../../tests/fixtures/noopCalcPlugin'
import { nbt } from '../domain/nbt'
import type { CalcModpack, CalcPlugin } from './calcPlugin'
import { PluginRegistry, runPlugins } from './pluginRegistry'
import type { VirtualPort } from './virtualPort'

const bp = blueprintFixture()
  .place([0, 0, 0], 'create:shaft', { axis: 'x' })
  .place([1, 0, 0], 'create:cogwheel', { axis: 'x' }, nbt.compound({ Broken: nbt.byte(1) }))
  .toBlueprint()

function port(pluginId: string, kind: string): VirtualPort {
  return { id: kind, pos: [0, 0, 0], pluginId, kind, params: {} }
}

describe('PluginRegistry', () => {
  it('同じ id は2回登録できない', () => {
    const r = new PluginRegistry([noopCalcPlugin()])
    expect(() => r.register(noopCalcPlugin())).toThrow(/すでに登録/)
    expect(r.get(NOOP_PLUGIN_ID)?.label).toBe('テスト用')
    expect(r.get('none')).toBeNull()
  })

  it('available は supports が true のものだけ。例外を出すものは除く', () => {
    const throwing: CalcPlugin = {
      ...noopCalcPlugin(),
      id: 'throwing',
      supports: () => {
        throw new Error('x')
      },
    }
    const r = new PluginRegistry([noopCalcPlugin(), { ...noopCalcPlugin({ supports: false }), id: 'off' }, throwing])
    expect(r.available(bp, null).map((p) => p.id)).toEqual([NOOP_PLUGIN_ID])
  })
})

describe('runPlugins', () => {
  it('Modpack なしで内蔵の初期値を使い、結果と仮定を返す', async () => {
    const [o] = await runPlugins(new PluginRegistry([noopCalcPlugin()]), bp, null, [])
    expect(o.status).toBe('ok')
    if (o.status !== 'ok') return
    expect(o.result.summary).toEqual([
      { label: 'ブロック数', value: { value: '2', source: 'blueprint' } },
      { label: '係数', value: { value: '1', source: 'builtin' } },
    ])
    expect(o.result.issues).toEqual([{ pos: [1, 0, 0], message: '壊れている' }])
    expect(o.result.assumptions).toEqual([{ pos: [0, 0, 0], message: '範囲外は空気とみなした' }])
  })

  it('Modpack の設定ファイルの値を使う', async () => {
    const pack: CalcModpack = {
      hasNamespace: () => true,
      config: async (path) => (path === 'config/test.txt' ? '3' : null),
    }
    const [o] = await runPlugins(new PluginRegistry([noopCalcPlugin()]), bp, pack, [])
    expect(o.status === 'ok' && o.result.summary[1].value).toEqual({ value: '3', source: 'modpack' })
  })

  it('各プラグインには自分宛ての仮の入出力だけを渡す', async () => {
    const ports = [port(NOOP_PLUGIN_ID, 'mine'), port('other', 'theirs')]
    const [o] = await runPlugins(new PluginRegistry([noopCalcPlugin()]), bp, null, ports)
    const messages = o.status === 'ok' ? o.result.assumptions.map((a) => a.message) : []
    expect(messages).toContain('仮の入出力 mine を使った')
    expect(messages).not.toContain('仮の入出力 theirs を使った')
  })

  it('失敗したプラグインは error にし、ほかのプラグインは続ける', async () => {
    const r = new PluginRegistry([{ ...noopCalcPlugin({ fail: true }), id: 'failing' }, noopCalcPlugin()])
    const outcomes = await runPlugins(r, bp, null, [])
    expect(outcomes.map((o) => o.status)).toEqual(['error', 'ok'])
    expect(outcomes[0].status === 'error' && outcomes[0].message).toMatch(/テスト用の失敗/)
  })
})
