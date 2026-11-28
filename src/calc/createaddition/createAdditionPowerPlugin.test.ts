import { describe, expect, it } from 'vitest'
import { blueprintFixture, state } from '../../../tests/fixtures/blueprintFixture'
import type { BlockTransform } from '../../domain/blockTransform'
import { nbt, type NbtCompound } from '../../domain/nbt'
import type { Vec3 } from '../../domain/vec3'
import { createBuiltinRegistry } from '../builtinPlugins'
import type { CalcResult, CalcRotation } from '../calcPlugin'
import { runPlugins } from '../pluginRegistry'
import { CA_POWER_PLUGIN_ID, createAdditionPowerPlugin, earlierRotations, runCreateAdditionPower, transformCaBlockEntity } from './createAdditionPowerPlugin'

function wire(offset: Vec3, type = 0): NbtCompound {
  return nbt.compound({ id: nbt.int(0), other: nbt.int(0), type: nbt.int(type), x: nbt.int(offset[0]), y: nbt.int(offset[1]), z: nbt.int(offset[2]) })
}

const CONNECTOR = { rotation: 'none', variant: 'default' }

/** クリエイティブモーター（64 RPM）→ 発電機 →（電線）→ 電気モーター（32 RPM）→ シャフト */
function machine() {
  return blueprintFixture()
    .dataVersion(3955)
    .place([0, 0, 0], 'create:creative_motor', { facing: 'east' }, nbt.compound({ ScrollValue: nbt.int(64) }))
    .place([1, 0, 0], 'createaddition:alternator', { facing: 'east' })
    .place([1, 1, 0], 'createaddition:connector', { facing: 'down', mode: 'pull', ...CONNECTOR }, nbt.compound({ nodes: nbt.list('compound', [wire([4, 0, 0])]) }))
    .place([5, 1, 0], 'createaddition:connector', { facing: 'down', mode: 'push', ...CONNECTOR }, nbt.compound({ nodes: nbt.list('compound', [wire([-4, 0, 0])]) }))
    .place([5, 0, 0], 'createaddition:electric_motor', { facing: 'east', powered: 'false' }, nbt.compound({ ScrollValue: nbt.int(32), active: nbt.byte(1) }))
    .place([6, 0, 0], 'create:shaft', { axis: 'x' })
    .place([0, 2, 0], 'createaddition:modular_accumulator', { top: 'true', bottom: 'true' })
    .place([1, 2, 0], 'createaddition:small_light_connector', { facing: 'down', mode: 'none', powered: 'true', ...CONNECTOR })
    .place([0, 3, 0], 'createaddition:creative_energy')
    .toBlueprint()
}

function rotation(pos: Vec3, rpm: number, overloaded = false): CalcRotation {
  return { pos, axis: 'x', rpm, level: 'medium', overloaded }
}

function result(rotations?: CalcRotation[]): CalcResult {
  return { summary: [], issues: [], assumptions: [], ...(rotations ? { rotations } : {}) }
}

describe('Crafts & Additions の電力のプラグイン', () => {
  it('[CA-NET-SURPLUS] 内蔵の一覧で、Create の回転の結果を使って発電機の作る量を出す。モーターは Create の動力源になる', async () => {
    const outcomes = await runPlugins(createBuiltinRegistry(), machine(), null, [])
    expect(outcomes.map((o) => [o.pluginId, o.status])).toEqual([
      ['create-stress', 'ok'],
      [CA_POWER_PLUGIN_ID, 'ok'],
    ])
    const [create, power] = outcomes.map((o) => (o.status === 'ok' ? o.result : null))
    const rpm = new Map(create?.rotations?.map((r) => [r.pos.join(','), r.rpm]))
    expect([rpm.get('1,0,0'), rpm.get('5,0,0'), rpm.get('6,0,0')]).toEqual([64, 32, 32])
    // 電気モーターの容量は 64 SU/RPM × 32 RPM
    expect(create?.summary.map((s) => s.value.value).join(' ')).toContain('供給 2,048 SU')
    expect(power?.summary.map((s) => [s.label, s.value.value])).toEqual([
      ['電力の合計', '発電 いくらでも / 使用 61 FE/t'],
      ['電力 1', '発電 90 FE/t / 使用 60 FE/t（余り 30 FE/t）'],
      ['電力 2', '発電 いくらでも / 使用 0 FE/t'],
      ['電力 3', '発電 0 FE/t / 使用 1 FE/t'],
    ])
    expect(power?.assumptions.map((a) => a.message)).toContain('発電機の回転数は、回転の計算の結果を使った')
    const probe = (pos: string) => power?.probes?.find((p) => p.pos.join(',') === pos)?.values.map((v) => `${v.label}=${v.value.value}`)
    expect(probe('1,0,0')).toEqual(['ネットワーク=電力 1', '回転数=64 RPM', '作る量=90 FE/t'])
    expect(probe('5,0,0')).toEqual(['ネットワーク=電力 1', '設定の回転数=32 RPM', '使う量=60 FE/t', '状態=回っている'])
    expect(probe('1,1,0')).toEqual(['ネットワーク=電力 1', '付いたブロックと=取り込む', '上限=入力 1,000 / 出力 1,000 FE/t', '電線の長さの上限=16 ブロック'])
    expect(probe('5,1,0')?.[1]).toBe('付いたブロックと=出す')
    expect(probe('1,2,0')).toContain('使う量=1 FE/t')
    expect(probe('1,2,0')?.[1]).toBe('付いたブロックと=やりとりしない')
    expect(probe('0,2,0')).toEqual(['ネットワーク=電力 2', '容量=2,000,000 FE', '蓄えた量=0 FE'])
    expect(probe('0,3,0')).toEqual(['ネットワーク=電力 2', '作る量=いくらでも'])
    expect(power?.summary.find((s) => s.label === '電力 1')).toMatchObject({ pos: [1, 0, 0], network: true })
  })

  it('回転の結果がなければ、発電機は回っていないとみなす。電力のブロックがなければまとめは空', async () => {
    const r = await runCreateAdditionPower(machine(), { pack: null, ports: [] })
    expect(r.assumptions.map((a) => a.message)).toContain('回転の計算の結果がないので、発電機は回っていないとみなした')
    expect(r.probes?.find((p) => p.pos.join(',') === '1,0,0')?.values[1].value).toMatchObject({ value: '0 RPM', source: 'assumed' })
    expect(r.probes?.find((p) => p.pos.join(',') === '5,0,0')?.values[3].value.value).toBe('回っている')
    const stopped = blueprintFixture()
      .place([0, 0, 0], 'createaddition:electric_motor', { facing: 'east', powered: 'false' }, nbt.compound({ active: nbt.byte(0) }))
      .toBlueprint()
    expect((await runCreateAdditionPower(stopped, { pack: null, ports: [] })).probes?.[0].values.map((v) => v.value.value)).toEqual([
      '電力 1',
      '32 RPM',
      '0 FE/t',
      '止まっている',
    ])
    const mill = blueprintFixture().place([0, 0, 0], 'createaddition:rolling_mill', { facing: 'east' }).toBlueprint()
    expect((await runCreateAdditionPower(mill, { pack: null, ports: [], mode: 'running' })).summary).toEqual([])
  })

  it('前の結果の回転は、先に答えたものを使い、過負荷なら止まっているとみなす', () => {
    expect(earlierRotations(undefined)).toBeNull()
    expect(earlierRotations([{ pluginId: 'a', result: result() }])).toBeNull()
    const at = earlierRotations([
      { pluginId: 'a', result: result() },
      { pluginId: 'b', result: result([rotation([0, 0, 0], 12), rotation([1, 0, 0], 99, true)]) },
      { pluginId: 'c', result: result([rotation([0, 0, 0], 50)]) },
    ])!
    expect([at([0, 0, 0]), at([1, 0, 0]), at([2, 0, 0])]).toEqual([12, 0, null])
  })

  it('Crafts & Additions のブロックがある設計図だけを計算する', () => {
    const plugin = createAdditionPowerPlugin()
    expect(plugin.supports(machine(), null)).toBe(true)
    expect(plugin.supports(blueprintFixture().place([0, 0, 0], 'create:shaft', { axis: 'x' }).toBlueprint(), null)).toBe(false)
  })
})

describe('Crafts & Additions の回転・反転', () => {
  const turn: BlockTransform = { translate: [0, 0, 0], quarterTurns: 1, mirror: 'none', pivot: [0, 0, 0] }
  const box = { min: [0, 0, 0] as Vec3, max: [5, 5, 5] as Vec3 }
  const conn = state('createaddition:connector', { facing: 'down', mode: 'none' })

  it('[CA-TF-NODES] 電線の相対位置を回す。範囲の外を指す電線は unresolved', () => {
    const be = nbt.compound({ nodes: nbt.list('compound', [wire([0, 0, -2]), nbt.compound({ x: nbt.int(1) }), wire([4, 0, 0])]), other: nbt.int(1) })
    const out = transformCaBlockEntity(conn, be, turn, [2, 0, 2], [2, 0, 2], box)!
    const list = out.nbt.value.get('nodes')
    expect(list?.type === 'list' && list.value.map((n) => (n.type === 'compound' ? [n.value.get('x')?.value, n.value.get('z')?.value] : null))).toEqual([
      [2, 0],
      [1, undefined],
      [0, 4],
    ])
    expect(out.unresolved).toBe(true)
    expect(out.nbt.value.get('other')).toEqual(nbt.int(1))
    expect(transformCaBlockEntity(conn, nbt.compound({ nodes: nbt.list('compound', [wire([1, 0, 0])]) }), turn, [0, 0, 0], [0, 0, 0], box)?.unresolved).toBe(false)
  })

  it('電線のないブロック・ほかの Mod のブロックは null。リストでない項目はそのまま', () => {
    expect(transformCaBlockEntity(conn, nbt.compound({}), turn, [0, 0, 0], [0, 0, 0], box)).toBeNull()
    expect(transformCaBlockEntity(state('create:shaft'), nbt.compound({ nodes: nbt.list('compound', []) }), turn, [0, 0, 0], [0, 0, 0], box)).toBeNull()
    const ints = nbt.compound({ nodes: nbt.list('int', [nbt.int(1)]) })
    expect(transformCaBlockEntity(conn, ints, turn, [0, 0, 0], [0, 0, 0], box)?.nbt.value.get('nodes')).toEqual(nbt.list('int', [nbt.int(1)]))
  })
})
