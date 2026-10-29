import { describe, expect, it } from 'vitest'
import { blueprintFixture, type BlueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import type { Blueprint } from '../../domain/blueprint'
import { nbt } from '../../domain/nbt'
import type { Vec3 } from '../../domain/vec3'
import { AssumptionLog } from '../assumptionLog'
import type { VirtualPort } from '../virtualPort'
import type { CreateServerConfig } from './createConfig'
import { CreateValueResolver } from './createValueResolver'
import { KineticGraph, OUT_OF_RANGE_NOTE, type KineticEvaluation } from './kineticGraph'

interface Evaluated {
  graph: KineticGraph
  ev: KineticEvaluation
  log: AssumptionLog
  /** pos の実際の回転数 */
  speed(pos: Vec3): number
  /** pos のノードがあるネットワーク */
  network(pos: Vec3): KineticEvaluation['networks'][number]
  issuesAt(pos: Vec3): string[]
}

function evaluate(bp: Blueprint, ports: VirtualPort[] = [], config: CreateServerConfig | null = null): Evaluated {
  const log = new AssumptionLog()
  const values = new CreateValueResolver(config)
  const graph = KineticGraph.build(bp, ports, values, log)
  const ev = graph.evaluate({ maxRotationSpeed: values.maxRotationSpeed().value, disableStress: values.disableStress().value })
  const index = (pos: Vec3): number => {
    const i = graph.nodes.findIndex((n) => n.portId === null && n.pos.join() === pos.join())
    if (i < 0) throw new Error(`${pos.join()} にノードがありません`)
    return i
  }
  return {
    graph,
    ev,
    log,
    speed: (pos) => ev.nodes[index(pos)].speed,
    network: (pos) => ev.networks[ev.nodes[index(pos)].network],
    issuesAt: (pos) => ev.issues.filter((i) => i.pos.join() === pos.join()).map((i) => i.message),
  }
}

const scroll = (v: number) => nbt.compound({ ScrollValue: nbt.int(v) })

/** 例1 */
function example1(): BlueprintFixture {
  return blueprintFixture()
    .place([0, 0, 0], 'create:water_wheel', { facing: 'south' }, nbt.compound({ FlowScore: nbt.int(1) }))
    .place([0, 0, 1], 'create:large_cogwheel', { axis: 'z' })
    .place([1, 1, 1], 'create:cogwheel', { axis: 'z' })
    .place([1, 1, 2], 'create:mechanical_press', { facing: 'south' })
    .place([1, 1, 3], 'create:mechanical_press', { facing: 'south' })
}

describe('KineticGraph：docs/create-stress.md の例', () => {
  it('例1：水車と大歯車で加速し、プレスを回す（ちょうど足りる）', () => {
    const r = evaluate(example1().toBlueprint())
    expect(r.speed([0, 0, 0])).toBe(8)
    expect(r.speed([0, 0, 1])).toBe(8)
    expect(r.speed([1, 1, 1])).toBe(-16)
    expect(r.speed([1, 1, 2])).toBe(-16)
    expect(r.speed([1, 1, 3])).toBe(-16)
    const net = r.network([0, 0, 0])
    expect(net.capacity).toBe(256)
    expect(net.stress).toBe(256)
    expect(net.overloaded).toBe(false)
    expect(r.ev.issues).toEqual([])
  })

  it('例1：プレスを1台足すと過負荷になり、全部 0 RPM', () => {
    const r = evaluate(example1().place([1, 1, 4], 'create:mechanical_press', { facing: 'south' }).toBlueprint())
    const net = r.network([0, 0, 0])
    expect(net.stress).toBe(384)
    expect(net.overloaded).toBe(true)
    for (const pos of [[0, 0, 0], [0, 0, 1], [1, 1, 1], [1, 1, 4]] as Vec3[]) {
      expect(r.speed(pos)).toBe(0)
      expect(r.issuesAt(pos).some((m) => m.startsWith('応力が足りません'))).toBe(true)
    }
  })

  it('例2：速度コントローラー', () => {
    const bp = blueprintFixture()
      .place([0, 0, 0], 'create:creative_motor', { facing: 'east' }, scroll(16))
      .place([1, 0, 0], 'create:shaft', { axis: 'x' })
      .place([2, 0, 0], 'create:rotation_speed_controller', { axis: 'x' }, scroll(64))
      .place([2, 1, 0], 'create:large_cogwheel', { axis: 'z' })
      .place([2, 1, 1], 'create:crushing_wheel', { axis: 'z' })
      .toBlueprint()
    const r = evaluate(bp)
    expect(r.speed([0, 0, 0])).toBe(16)
    expect(r.speed([1, 0, 0])).toBe(16)
    expect(r.speed([2, 0, 0])).toBe(16)
    expect(r.speed([2, 1, 0])).toBe(64)
    expect(r.speed([2, 1, 1])).toBe(64)
    // 1つのネットワーク
    expect(r.network([0, 0, 0])).toBe(r.network([2, 1, 1]))
    expect(r.network([0, 0, 0]).stress).toBe(512)
    expect(r.network([0, 0, 0]).capacity).toBe(262144)
    expect(r.ev.issues).toEqual([])
  })

  it('例2：入力側が止まっていれば、出力側も回らない', () => {
    const bp = blueprintFixture()
      .place([1, 0, 0], 'create:shaft', { axis: 'x' })
      .place([2, 0, 0], 'create:rotation_speed_controller', { axis: 'x' }, scroll(64))
      .place([2, 1, 0], 'create:large_cogwheel', { axis: 'z' })
      .toBlueprint()
    expect(evaluate(bp).speed([2, 1, 0])).toBe(0)
  })

  it('例3：向きの衝突。ScrollValue を -16 にすると衝突しない', () => {
    const build = (right: number) =>
      blueprintFixture()
        .place([0, 0, 0], 'create:creative_motor', { facing: 'east' }, scroll(16))
        .place([1, 0, 0], 'create:shaft', { axis: 'x' })
        .place([2, 0, 0], 'create:creative_motor', { facing: 'west' }, scroll(right))
        .toBlueprint()
    const bad = evaluate(build(16))
    expect(bad.speed([1, 0, 0])).toBe(0)
    expect(bad.issuesAt([0, 0, 0]).some((m) => m.includes('向きがぶつかって'))).toBe(true)
    expect(bad.issuesAt([2, 0, 0]).some((m) => m.includes('向きがぶつかって'))).toBe(true)

    const good = evaluate(build(-16))
    expect(good.ev.issues).toEqual([])
    expect(good.speed([1, 0, 0])).toBe(16)
    expect(good.speed([2, 0, 0])).toBe(16)
    // 押し切られた動力源の容量も数える
    expect(good.network([1, 0, 0]).capacity).toBe(16384 * 16 * 2)
  })

  it('例4：速度の衝突', () => {
    const bp = blueprintFixture()
      .place([0, 0, 0], 'create:large_cogwheel', { axis: 'z' })
      .place([1, 1, 0], 'create:cogwheel', { axis: 'z' })
      .place([0, 1, 0], 'create:cogwheel', { axis: 'z' })
      .place([0, 0, 1], 'create:encased_chain_drive', { axis: 'z', axis_along_first: 'false', part: 'start' })
      .place([0, 1, 1], 'create:encased_chain_drive', { axis: 'z', axis_along_first: 'false', part: 'end' })
      .toBlueprint()
    const r = evaluate(bp)
    const conflicts = r.ev.issues.filter((i) => i.message.startsWith('回転数がぶつかって'))
    expect(conflicts.length).toBeGreaterThan(0)
    // 辺の位置を出す
    expect(conflicts.map((i) => i.pos.join(' '))).toContain('0 1 0')
  })

  it('例4：チェーンだけなら比は 1 で衝突しない', () => {
    const bp = blueprintFixture()
      .place([0, 0, 0], 'create:creative_motor', { facing: 'south' }, scroll(16))
      .place([0, 0, 1], 'create:encased_chain_drive', { axis: 'z', axis_along_first: 'false', part: 'start' })
      .place([0, 1, 1], 'create:encased_chain_drive', { axis: 'z', axis_along_first: 'false', part: 'end' })
      .place([0, 1, 2], 'create:shaft', { axis: 'z' })
      .toBlueprint()
    const r = evaluate(bp)
    expect(r.ev.issues).toEqual([])
    expect(r.speed([0, 1, 2])).toBe(16)
  })

  it('例5：ギアボックスの向き', () => {
    const bp = blueprintFixture()
      .place([0, 0, 1], 'create:creative_motor', { facing: 'east' }, scroll(16))
      .place([1, 0, 1], 'create:gearbox', { axis: 'y' })
      .place([2, 0, 1], 'create:shaft', { axis: 'x' })
      .place([1, 0, 0], 'create:shaft', { axis: 'z' })
      .place([1, 0, 2], 'create:shaft', { axis: 'z' })
      .toBlueprint()
    const r = evaluate(bp)
    expect(r.speed([2, 0, 1])).toBe(-16)
    expect(r.speed([1, 0, 0])).toBe(-16)
    expect(r.speed([1, 0, 2])).toBe(16)
    expect(r.ev.issues).toEqual([])
  })

  it('例6：蒸気エンジン', () => {
    const bp = blueprintFixture()
      .place(
        [0, 0, 0],
        'create:powered_shaft',
        { axis: 'x' },
        nbt.compound({
          EnginePower: nbt.float(1),
          Direction: nbt.int(1),
          EngineType: nbt.string('create:steam_engine'),
        }),
      )
      .toBlueprint()
    const r = evaluate(bp)
    expect(r.speed([0, 0, 0])).toBe(64)
    expect(r.network([0, 0, 0]).capacity).toBe(16384)
  })
})

describe('KineticGraph：つながりの規則', () => {
  it('大歯車同士は直角に組んだ斜めでかみ合う', () => {
    const bp = blueprintFixture()
      .place([0, 0, 0], 'create:creative_motor', { facing: 'up' }, scroll(16))
      .place([0, 1, 0], 'create:large_cogwheel', { axis: 'y' })
      .place([1, 2, 0], 'create:large_cogwheel', { axis: 'x' })
      .toBlueprint()
    const r = evaluate(bp)
    expect(r.speed([0, 1, 0])).toBe(16)
    // 差 (1, 1, 0)：A の軸 y の成分 > 0、B の軸 x の成分 > 0 → 比 1
    expect(r.speed([1, 2, 0])).toBe(16)
  })

  it('小歯車同士は −1、軸の向きに重ねるとシャフトとしてつながる', () => {
    const bp = blueprintFixture()
      .place([0, 0, 0], 'create:creative_motor', { facing: 'up' }, scroll(16))
      .place([0, 1, 0], 'create:cogwheel', { axis: 'y' })
      .place([1, 1, 0], 'create:cogwheel', { axis: 'y' })
      .place([1, 2, 0], 'create:cogwheel', { axis: 'y' })
      .toBlueprint()
    const r = evaluate(bp)
    expect(r.speed([1, 1, 0])).toBe(-16)
    expect(r.speed([1, 2, 0])).toBe(-16)
  })

  it('ギアシフトに信号が入ると逆回り、クラッチに信号が入ると切れる', () => {
    const build = (block: string, powered: string) =>
      blueprintFixture()
        .place([0, 0, 0], 'create:creative_motor', { facing: 'east' }, scroll(16))
        .place([1, 0, 0], block, { axis: 'x', powered })
        .place([2, 0, 0], 'create:shaft', { axis: 'x' })
        .toBlueprint()
    expect(evaluate(build('create:gearshift', 'false')).speed([2, 0, 0])).toBe(16)
    expect(evaluate(build('create:gearshift', 'true')).speed([2, 0, 0])).toBe(-16)
    expect(evaluate(build('create:clutch', 'false')).speed([2, 0, 0])).toBe(16)
    expect(evaluate(build('create:clutch', 'true')).speed([2, 0, 0])).toBe(0)
  })

  it('ベルトはブロック状態だけで区間をたどる', () => {
    const bp = blueprintFixture()
      .place([0, 0, 0], 'create:creative_motor', { facing: 'south' }, scroll(32))
      .place([0, 0, 1], 'create:belt', { facing: 'east', slope: 'horizontal', part: 'start' })
      .place([1, 0, 1], 'create:belt', { facing: 'east', slope: 'horizontal', part: 'middle' })
      .place([2, 0, 1], 'create:belt', { facing: 'east', slope: 'horizontal', part: 'end' })
      .place([2, 0, 2], 'create:shaft', { axis: 'z' })
      .toBlueprint()
    const r = evaluate(bp)
    expect(r.speed([1, 0, 1])).toBe(32)
    expect(r.speed([2, 0, 2])).toBe(32)
  })

  it('ミキサーは中速（30 RPM）未満なら「回転数が足りない」', () => {
    const bp = blueprintFixture()
      .place([0, 0, 0], 'create:creative_motor', { facing: 'up' }, scroll(16))
      .place([0, 1, 0], 'create:cogwheel', { axis: 'y' })
      .place([1, 1, 0], 'create:mechanical_mixer')
      .toBlueprint()
    const r = evaluate(bp)
    expect(r.speed([1, 1, 0])).toBe(-16)
    expect(r.issuesAt([1, 1, 0]).some((m) => m.startsWith('回転数が足りません'))).toBe(true)
    // 足りなくても応力は数える
    expect(r.network([1, 1, 0]).stress).toBe(4 * 16)
  })

  it('上限を超えると速度超過', () => {
    const bp = blueprintFixture()
      .place([0, 0, 0], 'create:creative_motor', { facing: 'up' }, scroll(256))
      .place([0, 1, 0], 'create:large_cogwheel', { axis: 'y' })
      .place([1, 1, 1], 'create:cogwheel', { axis: 'y' })
      .toBlueprint()
    const r = evaluate(bp)
    expect(r.issuesAt([1, 1, 1]).some((m) => m.startsWith('回転が速すぎます'))).toBe(true)
  })
})

describe('KineticGraph：組み間違いの検査（#148）', () => {
  const motor = (b: BlueprintFixture, speed = 32) => b.place([0, 0, 0], 'create:creative_motor', { facing: 'east' }, scroll(speed))

  it('回るブロックなのにブロック状態がなければ、計算に入れず問題に出す', () => {
    const r = evaluate(motor(blueprintFixture()).place([1, 0, 0], 'create:mechanical_press').toBlueprint())
    expect(r.graph.nodes.some((n) => n.pos.join() === '1,0,0')).toBe(false)
    expect(r.issuesAt([1, 0, 0])).toEqual([expect.stringContaining('ブロック状態がないので、回転軸が決まりません')])
    expect(r.ev.issues.find((i) => i.pos.join() === '1,0,0')?.severity).toBeUndefined()
  })

  it('値の読めないブロック状態も問題に出す。回らないブロックは何も出さない', () => {
    const r = evaluate(
      blueprintFixture()
        .place([0, 0, 0], 'create:shaft', { axis: 'w' })
        .place([2, 0, 0], 'create:andesite_casing')
        .place([4, 0, 0], 'minecraft:stone')
        .toBlueprint(),
    )
    expect(r.issuesAt([0, 0, 0])).toEqual([expect.stringContaining('ブロック状態（axis=w）から回転軸が決まりません')])
    expect(r.issuesAt([2, 0, 0])).toEqual([])
    expect(r.issuesAt([4, 0, 0])).toEqual([])
  })

  it('動力源につながらない回るブロックは警告', () => {
    const r = evaluate(
      motor(blueprintFixture())
        .place([1, 0, 0], 'create:shaft', { axis: 'x' })
        .place([3, 0, 0], 'create:shaft', { axis: 'x' })
        .place([4, 0, 0], 'create:cogwheel', { axis: 'x' })
        .toBlueprint(),
    )
    expect(r.issuesAt([1, 0, 0])).toEqual([])
    for (const pos of [[3, 0, 0], [4, 0, 0]] as Vec3[]) {
      expect(r.issuesAt(pos)).toEqual(['動力源につながっていません。回りません。'])
    }
    expect(r.ev.issues.filter((i) => i.severity === 'warning')).toHaveLength(2)
  })

  it('動力源が止まっていれば、つながったブロックは「回転数が 0」の警告', () => {
    const r = evaluate(motor(blueprintFixture(), 0).place([1, 0, 0], 'create:shaft', { axis: 'x' }).toBlueprint())
    expect(r.issuesAt([0, 0, 0])).toEqual(['回転数が 0 です。つながっている動力源が止まっています。'])
    expect(r.issuesAt([1, 0, 0])).toEqual(['回転数が 0 です。つながっている動力源が止まっています。'])
  })

  it('仮の動力源につながっていれば警告を出さない', () => {
    const bp = blueprintFixture().place([0, 0, 0], 'create:shaft', { axis: 'x' }).toBlueprint()
    const port: VirtualPort = {
      id: 'p1',
      pluginId: 'create-stress',
      kind: 'rotation-source',
      pos: [0, 0, 0],
      face: 'west',
      params: { rpm: 32, capacity: 256 },
    }
    expect(evaluate(bp, [port]).ev.issues).toEqual([])
  })

  it('過負荷のネットワークには警告を重ねない', () => {
    const r = evaluate(
      blueprintFixture()
        .place([0, 0, 0], 'create:hand_crank', { facing: 'west' })
        .place([1, 0, 0], 'create:mechanical_press', { facing: 'east' })
        .place([2, 0, 0], 'create:mechanical_press', { facing: 'east' })
        .place([3, 0, 0], 'create:mechanical_press', { facing: 'east' })
        .toBlueprint(),
    )
    expect(r.network([1, 0, 0]).overloaded).toBe(true)
    expect(r.ev.issues.some((i) => i.severity === 'warning')).toBe(false)
  })
})

describe('KineticGraph：範囲外と仮の入出力', () => {
  it('軸の口の先が設計図の外なら、空気とみなして仮定に載せる', () => {
    const bp = blueprintFixture({ size: [3, 1, 1] })
      .place([0, 0, 0], 'create:shaft', { axis: 'x' })
      .place([1, 0, 0], 'create:shaft', { axis: 'x' })
      .toBlueprint()
    const r = evaluate(bp)
    const notes = r.log.list().filter((a) => a.message === OUT_OF_RANGE_NOTE)
    expect(notes.map((a) => a.pos)).toEqual([[0, 0, 0]])
  })

  it('仮の動力源と仮の負荷', () => {
    const bp = blueprintFixture({ size: [2, 1, 1] })
      .place([0, 0, 0], 'create:shaft', { axis: 'x' })
      .place([1, 0, 0], 'create:mechanical_press', { facing: 'east' })
      .toBlueprint()
    const ports: VirtualPort[] = [
      { id: 'in', pos: [0, 0, 0], face: 'west', pluginId: 'create-stress', kind: 'rotation-source', params: { rpm: -32, capacity: 1000 } },
      { id: 'out', pos: [1, 0, 0], face: 'east', pluginId: 'create-stress', kind: 'rotation-load', params: { stress: 500 } },
    ]
    const r = evaluate(bp, ports)
    expect(r.speed([1, 0, 0])).toBe(-32)
    const net = r.network([0, 0, 0])
    expect(net.capacity).toBe(1000)
    expect(net.stress).toBe(8 * 32 + 500)
    expect(net.overloaded).toBe(false)
    // 仮の入出力を置いた面は範囲外の仮定に載せない
    expect(r.log.list().some((a) => a.message === OUT_OF_RANGE_NOTE)).toBe(false)
  })

  it('軸の口がない面には仮の入出力をつなげない', () => {
    const bp = blueprintFixture().place([0, 0, 0], 'create:shaft', { axis: 'x' }).toBlueprint()
    const r = evaluate(bp, [
      { id: 'in', pos: [0, 0, 0], face: 'up', pluginId: 'create-stress', kind: 'rotation-source', params: { rpm: 16, capacity: 100 } },
    ])
    expect(r.issuesAt([0, 0, 0]).some((m) => m.includes('つなげません'))).toBe(true)
  })

  it('nbt のない水車は流れを仮定する', () => {
    const bp = blueprintFixture().place([0, 0, 0], 'create:water_wheel', { facing: 'north' }).toBlueprint()
    const r = evaluate(bp)
    expect(r.speed([0, 0, 0])).toBe(8)
    expect(r.log.list().some((a) => a.message.includes('FlowScore'))).toBe(true)
  })
})
