import { describe, expect, it } from 'vitest'
import { blueprintFixture, state, type BlueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import type { Blueprint } from '../../domain/blueprint'
import { nbt } from '../../domain/nbt'
import type { Vec3 } from '../../domain/vec3'
import { AssumptionLog } from '../assumptionLog'
import type { VirtualPort } from '../virtualPort'
import { readCreateServerConfig, type CreateServerConfig } from './createConfig'
import { CreateValueResolver } from './createValueResolver'
import { KineticGraph, OUT_OF_RANGE_NOTE, nextBeltSegment, type KineticEvaluation } from './kineticGraph'

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
  it('[ST-LINK-LARGE-SMALL][ST-SOURCE-WATER-WHEEL][ST-STEP-STRESS] 例1：水車と大歯車で加速し、プレスを回す（ちょうど足りる）', () => {
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
    // ちょうど足りるのは使用率 100% なので、余裕が少ない警告だけ（#159）
    expect(r.ev.issues.map((i) => [i.severity, i.message])).toEqual([
      ['warning', '応力の余裕が少なくなっています（使用 256 SU / 供給 256 SU、使用率 100%）。負荷を足すと止まります。（ブロック 5 個）'],
    ])
  })

  it('[ST-STEP-OVERLOAD][ST-RESULT-ISSUES] 例1：プレスを1台足すと過負荷になり、全部 0 RPM', () => {
    const r = evaluate(example1().place([1, 1, 4], 'create:mechanical_press', { facing: 'south' }).toBlueprint())
    const net = r.network([0, 0, 0])
    expect(net.stress).toBe(384)
    expect(net.overloaded).toBe(true)
    for (const pos of [[0, 0, 0], [0, 0, 1], [1, 1, 1], [1, 1, 4]] as Vec3[]) expect(r.speed(pos)).toBe(0)
    // ネットワーク全体の問題は1件にまとめ、全ブロックの位置を持つ（#153）
    const overload = r.ev.issues.filter((i) => i.message.startsWith('応力が足りません'))
    expect(overload).toHaveLength(1)
    expect(overload[0].message).toBe('応力が足りません（使用 384 SU / 供給 256 SU）。ネットワーク全体が止まります。（ブロック 6 個）')
    expect(overload[0].pos).toEqual([0, 0, 0])
    expect(overload[0].positions).toHaveLength(6)
    expect(overload[0].positions).toEqual(expect.arrayContaining([[0, 0, 0], [1, 1, 4]]))
  })

  it('[ST-LINK-CONTROLLER][ST-STEP-CONTROLLER][ST-STEP-NETWORKS] 例2：速度コントローラー', () => {
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

  it('[ST-STEP-CONTROLLER] 例2：入力側が止まっていれば、出力側も回らない', () => {
    const bp = blueprintFixture()
      .place([1, 0, 0], 'create:shaft', { axis: 'x' })
      .place([2, 0, 0], 'create:rotation_speed_controller', { axis: 'x' }, scroll(64))
      .place([2, 1, 0], 'create:large_cogwheel', { axis: 'z' })
      .toBlueprint()
    expect(evaluate(bp).speed([2, 1, 0])).toBe(0)
  })

  it('[ST-SOURCE-CREATIVE-MOTOR][ST-STEP-SPEED][ST-CAPACITY-GENERATED] 例3：向きの衝突。ScrollValue を -16 にすると衝突しない', () => {
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

  it('[ST-STEP-GROUPS][ST-STEP-RATIOS] 例4：速度の衝突', () => {
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

  it('[ST-LINK-CHAIN] 例4：チェーンだけなら比は 1 で衝突しない', () => {
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

  it('[ST-FACE-GEARBOX] 例5：ギアボックスの向き', () => {
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

  it('[ST-SOURCE-STEAM-ENGINE] 例6：蒸気エンジン', () => {
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
  it('[ST-LINK-LARGE-LARGE][ST-LINK-NEIGHBORS] 大歯車同士は直角に組んだ斜めでかみ合う', () => {
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

  it('[ST-LINK-COG][ST-LINK-SHAFT] 小歯車同士は −1、軸の向きに重ねるとシャフトとしてつながる', () => {
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

  it('[ST-FACE-GEARSHIFT][ST-FACE-CLUTCH] ギアシフトに信号が入ると逆回り、クラッチに信号が入ると切れる', () => {
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

  it('[ST-LINK-BELT] ベルトはブロック状態だけで区間をたどる', () => {
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

  it('[ST-LINK-SHAFT][ST-AXIS-DIRECTIONAL] 液体のバルブは軸でつながる（DirectionalAxisKineticBlock。#237）', () => {
    // facing=north（z）、axis_along_first=true → 回転軸 x
    const bp = blueprintFixture()
      .place([0, 0, 0], 'create:creative_motor', { facing: 'east' }, scroll(16))
      .place([1, 0, 0], 'create:fluid_valve', { facing: 'north', axis_along_first: 'true', enabled: 'false', waterlogged: 'false' })
      .place([2, 0, 0], 'create:shaft', { axis: 'x' })
      .toBlueprint()
    const r = evaluate(bp)
    expect(r.speed([1, 0, 0])).toBe(16)
    expect(r.speed([2, 0, 0])).toBe(16)
  })

  describe('[ST-LINK-GANTRY][ST-STEP-EDGES] ガントリー：信号を受けたシャフトと、その上の台車（規則 9。#237）', () => {
    const vec: Record<string, Vec3> = {
      up: [0, 1, 0],
      down: [0, -1, 0],
      east: [1, 0, 0],
      west: [-1, 0, 0],
      south: [0, 0, 1],
      north: [0, 0, -1],
    }
    const at = (base: Vec3, d: string, n: number): Vec3 => [base[0] + vec[d]![0] * n, base[1] + vec[d]![1] * n, base[2] + vec[d]![2] * n]
    /** shaft の向きのシャフトを3つ並べ、真ん中に pinion の向きの台車を付ける */
    const build = (shaft: string, pinion: string, alongFirst: string, powered: string) => {
      const motor: Vec3 = [4, 4, 4]
      const middle = at(motor, shaft, 2)
      const carriage = at(middle, pinion, 1)
      const bp = blueprintFixture()
        .place(motor, 'create:creative_motor', { facing: shaft }, scroll(16))
        .place(at(motor, shaft, 1), 'create:gantry_shaft', { facing: shaft, part: 'start', powered })
        .place(middle, 'create:gantry_shaft', { facing: shaft, part: 'middle', powered })
        .place(at(motor, shaft, 3), 'create:gantry_shaft', { facing: shaft, part: 'end', powered })
        .place(carriage, 'create:gantry_carriage', { facing: pinion, axis_along_first: alongFirst })
        .toBlueprint()
      return { r: evaluate(bp), middle, carriage }
    }

    // 期待する比は GantryCarriageBlockEntity.getGantryPinionModifier の表
    it.each([
      ['up', 'east', 'false', -1],
      ['up', 'west', 'false', 1],
      ['down', 'east', 'false', 1],
      ['east', 'south', 'false', -1],
      ['east', 'north', 'false', 1],
      ['south', 'up', 'true', -1],
      ['south', 'down', 'true', 1],
      ['north', 'down', 'true', -1],
    ])('シャフト %s・台車 %s：比 %s', (shaft, pinion, alongFirst, ratio) => {
      const { r, middle, carriage } = build(shaft, pinion, alongFirst, 'true')
      expect(Math.abs(r.speed(middle))).toBe(16)
      expect(r.speed(carriage)).toBe(r.speed(middle) * (ratio as number))
    })

    it('シャフトが信号を受けていなければ、台車はつながらない', () => {
      const { r, middle, carriage } = build('up', 'east', 'false', 'false')
      expect(r.speed(middle)).toBe(16)
      expect(r.speed(carriage)).toBe(0)
    })

    it('台車の軸の口は、ほかのシャフトとつながる', () => {
      // 台車 facing=east・axis_along_first=false → 回転軸 z
      const bp = blueprintFixture()
        .place([0, 0, 0], 'create:creative_motor', { facing: 'south' }, scroll(16))
        .place([0, 0, 1], 'create:gantry_carriage', { facing: 'east', axis_along_first: 'false' })
        .place([0, 0, 2], 'create:shaft', { axis: 'z' })
        .toBlueprint()
      expect(evaluate(bp).speed([0, 0, 2])).toBe(16)
    })
  })

  it('[ST-MIN-SPEED] ミキサーは中速（30 RPM）未満なら「回転数が足りない」', () => {
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

  it('[ST-STEP-MAX-SPEED] 上限を超えると速度超過', () => {
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

  it('[ST-STEP-NODES] 回るブロックなのにブロック状態がなければ、計算に入れず問題に出す', () => {
    const r = evaluate(motor(blueprintFixture()).place([1, 0, 0], 'create:mechanical_press').toBlueprint())
    expect(r.graph.nodes.some((n) => n.pos.join() === '1,0,0')).toBe(false)
    expect(r.issuesAt([1, 0, 0])).toEqual([expect.stringContaining('ブロック状態がないので、回転軸が決まりません')])
    expect(r.ev.issues.find((i) => i.pos.join() === '1,0,0')?.severity).toBeUndefined()
  })

  it('[ST-STEP-NODES] 値の読めないブロック状態も問題に出す。回らないブロックは何も出さない', () => {
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

  it('[ST-STEP-STOPPED][ST-RESULT-ISSUES] 動力源につながらない回るブロックは警告', () => {
    const r = evaluate(
      motor(blueprintFixture())
        .place([1, 0, 0], 'create:shaft', { axis: 'x' })
        .place([3, 0, 0], 'create:shaft', { axis: 'x' })
        .place([4, 0, 0], 'create:cogwheel', { axis: 'x' })
        .toBlueprint(),
    )
    expect(r.issuesAt([1, 0, 0])).toEqual([])
    // ネットワークごとに1件（#153）
    expect(r.ev.issues).toEqual([
      {
        pos: [3, 0, 0],
        message: '動力源につながっていません。回りません。（ブロック 2 個）',
        severity: 'warning',
        positions: [[3, 0, 0], [4, 0, 0]],
      },
    ])
  })

  it('[ST-STEP-STOPPED] 動力源が止まっていれば、つながったブロックは「回転数が 0」の警告', () => {
    const r = evaluate(motor(blueprintFixture(), 0).place([1, 0, 0], 'create:shaft', { axis: 'x' }).toBlueprint())
    expect(r.ev.issues.map((i) => [i.message, i.positions])).toEqual([
      ['回転数が 0 です。つながっている動力源が止まっています。（ブロック 2 個）', [[0, 0, 0], [1, 0, 0]]],
    ])
  })

  it('[ST-STEP-STOPPED][ST-PORT-SOURCE] 仮の動力源につながっていれば警告を出さない', () => {
    const bp = blueprintFixture().place([0, 0, 0], 'create:shaft', { axis: 'x' }).toBlueprint()
    const port: VirtualPort = {
      id: 'p1',
      pluginId: 'create-stress',
      kind: 'rotation-source',
      pos: [0, 0, 0],
      params: { rpm: 32, capacity: 256 },
    }
    expect(evaluate(bp, [port]).ev.issues).toEqual([])
  })

  it('[ST-STEP-OVERLOAD] 過負荷のネットワークには警告を重ねない', () => {
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
  it('[ST-STEP-OUT-OF-RANGE] 軸の口の先が設計図の外なら、空気とみなして仮定に載せる', () => {
    const bp = blueprintFixture({ size: [3, 1, 1] })
      .place([0, 0, 0], 'create:shaft', { axis: 'x' })
      .place([1, 0, 0], 'create:shaft', { axis: 'x' })
      .toBlueprint()
    const r = evaluate(bp)
    const notes = r.log.list().filter((a) => a.message === OUT_OF_RANGE_NOTE)
    expect(notes.map((a) => a.pos)).toEqual([[0, 0, 0]])
  })

  it('[ST-PORT-SOURCE][ST-PORT-LOAD][ST-PORT-SIGN][ST-PORT-OUT-OF-RANGE] 仮の動力源と仮の負荷', () => {
    const bp = blueprintFixture({ size: [2, 1, 1] })
      .place([0, 0, 0], 'create:shaft', { axis: 'x' })
      .place([1, 0, 0], 'create:mechanical_press', { facing: 'east' })
      .toBlueprint()
    const ports: VirtualPort[] = [
      { id: 'in', pos: [0, 0, 0], pluginId: 'create-stress', kind: 'rotation-source', params: { rpm: -32, capacity: 1000 } },
      { id: 'out', pos: [1, 0, 0], pluginId: 'create-stress', kind: 'rotation-load', params: { stress: 500 } },
    ]
    const r = evaluate(bp, ports)
    expect(r.speed([1, 0, 0])).toBe(-32)
    const net = r.network([0, 0, 0])
    expect(net.capacity).toBe(1000)
    expect(net.stress).toBe(8 * 32 + 500)
    expect(net.overloaded).toBe(false)
    // 仮の入出力を付けたブロックは範囲外の仮定に載せない
    expect(r.log.list().some((a) => a.message === OUT_OF_RANGE_NOTE)).toBe(false)
    // 動力源の向きは選んでいないので、仮定に載せる
    expect(r.log.list().filter((a) => a.message === '仮の動力源は、付けたブロックと同じ向きに回るとみなした').map((a) => a.pos)).toEqual([[0, 0, 0]])
  })

  it('[ST-RESULT-ISSUES] 応力の使用率が 90% を超えたら、ネットワークごとに1件の警告（#159）', () => {
    const bp = blueprintFixture({ size: [2, 1, 1] })
      .place([0, 0, 0], 'create:shaft', { axis: 'x' })
      .place([1, 0, 0], 'create:shaft', { axis: 'x' })
      .toBlueprint()
    const withLoad = (stress: number): VirtualPort[] => [
      { id: 'in', pos: [0, 0, 0], pluginId: 'create-stress', kind: 'rotation-source', params: { rpm: 32, capacity: 1000 } },
      { id: 'out', pos: [1, 0, 0], pluginId: 'create-stress', kind: 'rotation-load', params: { stress } },
    ]
    // ちょうど 90% は出さない
    expect(evaluate(bp, withLoad(900)).ev.issues).toEqual([])
    expect(evaluate(bp, withLoad(901)).ev.issues).toEqual([
      {
        pos: [0, 0, 0],
        message: '応力の余裕が少なくなっています（使用 901 SU / 供給 1,000 SU、使用率 90%）。負荷を足すと止まります。（ブロック 2 個）',
        severity: 'warning',
        positions: [[0, 0, 0], [1, 0, 0]],
      },
    ])
    // 過負荷ならエラーだけ（警告を重ねない）
    const over = evaluate(bp, withLoad(1001)).ev.issues
    expect(over.map((i) => i.severity ?? 'error')).toEqual(['error'])
  })

  it('[ST-PORT-ATTACH] 面を選ばずにブロックに付ける。回転しないブロックにはつなげない（#195）', () => {
    // 以前は軸の口でない面（シャフトの上）には付けられなかった。今はブロックそのものが回る
    const bp = blueprintFixture({ size: [2, 1, 1] })
      .place([0, 0, 0], 'create:shaft', { axis: 'x' })
      .place([1, 0, 0], 'minecraft:stone')
      .toBlueprint()
    const r = evaluate(bp, [
      { id: 'in', pos: [0, 0, 0], pluginId: 'create-stress', kind: 'rotation-source', params: { rpm: 16, capacity: 100 } },
      { id: 'bad', pos: [1, 0, 0], pluginId: 'create-stress', kind: 'rotation-load', params: { stress: 10 } },
    ])
    expect(r.speed([0, 0, 0])).toBe(16)
    expect(r.issuesAt([0, 0, 0])).toEqual([])
    expect(r.issuesAt([1, 0, 0]).some((m) => m.includes('つなげません'))).toBe(true)
  })

  it('[ST-PORT-ATTACH] ギアボックスに付けた動力源は、ギアボックスの回転数になる', () => {
    const bp = blueprintFixture({ size: [2, 1, 1] })
      .place([0, 0, 0], 'create:gearbox', { axis: 'y' })
      .place([1, 0, 0], 'create:shaft', { axis: 'x' })
      .toBlueprint()
    const r = evaluate(bp, [
      { id: 'in', pos: [0, 0, 0], pluginId: 'create-stress', kind: 'rotation-source', params: { rpm: 32, capacity: 1000 } },
    ])
    expect(Math.abs(r.speed([1, 0, 0]))).toBe(32)
    expect(r.network([1, 0, 0]).capacity).toBe(1000)
  })

  it('[ST-SOURCE-WATER-WHEEL] nbt のない水車は流れを仮定する', () => {
    const bp = blueprintFixture().place([0, 0, 0], 'create:water_wheel', { facing: 'north' }).toBlueprint()
    const r = evaluate(bp)
    expect(r.speed([0, 0, 0])).toBe(8)
    expect(r.log.list().some((a) => a.message.includes('FlowScore'))).toBe(true)
  })
})

describe('KineticGraph：書類の規則ごとの確かめ（#237）', () => {
  it('[ST-LINK-CHAIN] 可変チェーンギアシフトは Signal で比が変わる（0 なら 1、それ以外は 1 + (Signal + 1) / 16）', () => {
    const build = (signal: number) =>
      blueprintFixture()
        .place([0, 0, 0], 'create:creative_motor', { facing: 'south' }, scroll(16))
        .place(
          [0, 0, 1],
          'create:adjustable_chain_gearshift',
          { axis: 'z', axis_along_first: 'false', part: 'start', powered: 'false' },
          nbt.compound({ Signal: nbt.int(signal) }),
        )
        .place([0, 1, 1], 'create:encased_chain_drive', { axis: 'z', axis_along_first: 'false', part: 'end' })
        .place([0, 1, 2], 'create:shaft', { axis: 'z' })
        .toBlueprint()
    expect(evaluate(build(0)).speed([0, 1, 2])).toBe(16)
    // Signal がなければ 0 とみなす
    const noSignal = blueprintFixture()
      .place([0, 0, 0], 'create:creative_motor', { facing: 'south' }, scroll(16))
      .place([0, 0, 1], 'create:adjustable_chain_gearshift', { axis: 'z', axis_along_first: 'false', part: 'start', powered: 'false' })
      .place([0, 1, 1], 'create:encased_chain_drive', { axis: 'z', axis_along_first: 'false', part: 'end' })
      .toBlueprint()
    expect(evaluate(noSignal).speed([0, 1, 1])).toBe(16)
    // 15 → 1 + 16 / 16 = 2
    expect(evaluate(build(15)).speed([0, 1, 2])).toBe(32)
    // 7 → 1 + 8 / 16 = 1.5
    expect(evaluate(build(7)).speed([0, 1, 2])).toBe(24)
  })

  it('[ST-LINK-CHAIN] つながる向き（axis_along_first で決まる）が違うチェーンドライブはつながらない', () => {
    // 下は axis=z・axis_along_first=false でつながる向きは y。上は true で x
    const bp = blueprintFixture()
      .place([0, 0, 0], 'create:creative_motor', { facing: 'south' }, scroll(16))
      .place([0, 0, 1], 'create:encased_chain_drive', { axis: 'z', axis_along_first: 'false', part: 'start' })
      .place([0, 1, 1], 'create:encased_chain_drive', { axis: 'z', axis_along_first: 'true', part: 'end' })
      .toBlueprint()
    expect(evaluate(bp).speed([0, 1, 1])).toBe(0)
  })

  it('[ST-LINK-CHAIN-CONVEYOR][ST-NBT-POS] チェーンコンベアは Connections の相手と比 1。位置は int 配列と {X, Y, Z} の両方を読む', () => {
    const conveyor = (rel: 'array' | 'compound', to: Vec3) =>
      nbt.compound({
        Connections: nbt.list('compound', [
          rel === 'array'
            ? nbt.intArray(to)
            : nbt.compound({ X: nbt.int(to[0]), Y: nbt.int(to[1]), Z: nbt.int(to[2]) }),
        ] as never),
      })
    for (const form of ['array', 'compound'] as const) {
      const bp = blueprintFixture()
        .place([0, 0, 0], 'create:creative_motor', { facing: 'up' }, scroll(16))
        .place([0, 1, 0], 'create:chain_conveyor', {}, conveyor(form, [3, 0, 0]))
        .place([3, 1, 0], 'create:chain_conveyor', {}, conveyor(form, [-3, 0, 0]))
        .toBlueprint()
      const r = evaluate(bp)
      expect(r.speed([3, 1, 0]), form).toBe(16)
      // 互いに持つつながりは1本の辺
      expect(r.graph.edges.filter((e) => e.kind === 'chain-conveyor'), form).toHaveLength(1)
    }
  })

  it('[ST-LINK-CHAIN-CONVEYOR] つながる先が設計図の外なら、仮定に載せる', () => {
    const bp = blueprintFixture({ size: [1, 2, 1] })
      .place([0, 0, 0], 'create:creative_motor', { facing: 'up' }, scroll(16))
      .place([0, 1, 0], 'create:chain_conveyor', {}, nbt.compound({ Connections: nbt.list('intArray', [nbt.intArray([5, 0, 0])]) }))
      .toBlueprint()
    const r = evaluate(bp)
    expect(r.log.list().some((a) => a.message.startsWith('チェーンコンベアのつながる先が設計図の外'))).toBe(true)
  })

  it('[ST-FACE-SEQUENCED-GEARSHIFT] シーケンスギアシフトは待機中とみなし、2つの面の間を切って仮定に載せる', () => {
    const gearshift = { axis: 'x', vertical: 'false', state: '0' }
    // 東（軸の正の面）から回すと、ギアシフトは回り、西のシャフトには伝わらない
    const fromEast = evaluate(
      blueprintFixture()
        .place([0, 0, 0], 'create:shaft', { axis: 'x' })
        .place([1, 0, 0], 'create:sequenced_gearshift', gearshift)
        .place([2, 0, 0], 'create:creative_motor', { facing: 'west' }, scroll(16))
        .toBlueprint(),
    )
    expect(fromEast.speed([1, 0, 0])).toBe(-16)
    expect(fromEast.speed([0, 0, 0])).toBe(0)
    expect(fromEast.log.list().some((a) => a.message.startsWith('シーケンスギアシフトは待機中'))).toBe(true)
    // 西から回しても、東のシャフトには伝わらない
    const fromWest = evaluate(
      blueprintFixture()
        .place([0, 0, 0], 'create:creative_motor', { facing: 'east' }, scroll(16))
        .place([1, 0, 0], 'create:sequenced_gearshift', gearshift)
        .place([2, 0, 0], 'create:shaft', { axis: 'x' })
        .toBlueprint(),
    )
    expect(fromWest.speed([2, 0, 0])).toBe(0)
  })

  it('[ST-SOURCE-WINDMILL] 風車は Running と LastGenerated の回転数。nbt がなければ止まっているとみなす', () => {
    const build = (be: ReturnType<typeof nbt.compound> | undefined) =>
      blueprintFixture().place([0, 0, 0], 'create:windmill_bearing', { facing: 'up' }, be).toBlueprint()
    const running = evaluate(build(nbt.compound({ Running: nbt.byte(1), LastGenerated: nbt.float(4) })))
    expect(running.speed([0, 0, 0])).toBe(4)
    expect(running.network([0, 0, 0]).capacity).toBe(512 * 4)
    expect(evaluate(build(nbt.compound({ Running: nbt.byte(0), LastGenerated: nbt.float(4) }))).speed([0, 0, 0])).toBe(0)
    const unknown = evaluate(build(undefined))
    expect(unknown.speed([0, 0, 0])).toBe(0)
    expect(unknown.log.list().some((a) => a.message.startsWith('風車が回っているかが分からない'))).toBe(true)
  })

  it('[ST-SOURCE-CRANK] ハンドルは回しているとみなし 32 RPM。Backwards と負の向きで符号が変わる', () => {
    const build = (facing: string, backwards: boolean) =>
      blueprintFixture()
        .place([0, 0, 0], 'create:hand_crank', { facing }, nbt.compound({ Backwards: nbt.byte(backwards ? 1 : 0) }))
        .toBlueprint()
    expect(evaluate(build('east', false)).speed([0, 0, 0])).toBe(32)
    expect(evaluate(build('east', true)).speed([0, 0, 0])).toBe(-32)
    expect(evaluate(build('west', false)).speed([0, 0, 0])).toBe(-32)
    expect(evaluate(build('west', true)).speed([0, 0, 0])).toBe(32)
    const r = evaluate(build('up', false))
    expect(r.network([0, 0, 0]).capacity).toBe(8 * 32)
    expect(r.log.list().some((a) => a.message === 'ハンドルは回しているとみなした')).toBe(true)
  })

  it('[ST-CAPACITY-VALVE-HANDLE] 色付きのバルブのハンドルは、銅のハンドルの容量を使う', () => {
    const bp = blueprintFixture().place([0, 0, 0], 'create:red_valve_handle', { facing: 'up' }).toBlueprint()
    expect(evaluate(bp).network([0, 0, 0]).capacity).toBe(8 * 32)
    // 設定ファイルで銅のハンドルだけを変えると、色付きのハンドルも変わる。色ごとの項目は使わない
    const config = readCreateServerConfig(
      ['[kinetics]', '[kinetics.stressValues.v2.capacity]', 'copper_valve_handle = 10.0', 'red_valve_handle = 100.0'].join('\n'),
      'create-server.toml',
    )
    expect(evaluate(bp, [], config).network([0, 0, 0]).capacity).toBe(10 * 32)
  })

  it('[ST-STEP-SPEED] 同じ向きの動力源が2つあれば、速いほうの回転数になる', () => {
    const bp = blueprintFixture()
      .place([0, 0, 0], 'create:creative_motor', { facing: 'east' }, scroll(16))
      .place([1, 0, 0], 'create:shaft', { axis: 'x' })
      .place([2, 0, 0], 'create:creative_motor', { facing: 'west' }, scroll(-64))
      .toBlueprint()
    const r = evaluate(bp)
    expect(r.speed([1, 0, 0])).toBe(64)
    expect(r.ev.issues).toEqual([])
  })

  it('[ST-STEP-NODES] Create の追加 Mod のブロックは計算に入れず、仮定に載せる。ほかの Mod は何も載せない', () => {
    const bp = blueprintFixture()
      .place([0, 0, 0], 'createaddition:electric_motor', { facing: 'east' })
      .place([1, 0, 0], 'minecraft:stone')
      .toBlueprint()
    const r = evaluate(bp)
    expect(r.graph.nodes).toHaveLength(0)
    expect(r.log.list().map((a) => a.message)).toEqual(['createaddition:electric_motor は Create の追加 Mod のブロックなので、計算に入れていない'])
  })
})

describe('KineticGraph：規則の分かれ道（#237）', () => {
  it('[ST-LINK-LARGE-LARGE] 差の2つの成分の符号が違えば −1', () => {
    const bp = blueprintFixture()
      .place([0, 0, 0], 'create:creative_motor', { facing: 'up' }, scroll(16))
      .place([0, 1, 0], 'create:large_cogwheel', { axis: 'y' })
      .place([1, 0, 0], 'create:large_cogwheel', { axis: 'x' })
      .toBlueprint()
    // 差 (1, −1, 0)：A の軸 y の成分 < 0、B の軸 x の成分 > 0 → −1
    expect(evaluate(bp).speed([1, 0, 0])).toBe(-16)
  })

  it('[ST-LINK-LARGE-SMALL] 小歯車から大歯車へは −0.5', () => {
    const bp = blueprintFixture()
      .place([0, 0, 0], 'create:creative_motor', { facing: 'up' }, scroll(16))
      .place([0, 1, 0], 'create:cogwheel', { axis: 'y' })
      .place([1, 1, 1], 'create:large_cogwheel', { axis: 'y' })
      .toBlueprint()
    expect(evaluate(bp).speed([1, 1, 1])).toBe(-8)
  })

  it('[ST-STEP-RATIOS] つながり方で向きが1つに決まらなければ、向きの衝突', () => {
    // 2つの小歯車（−1）と、その後ろのチェーン（1）で輪になる
    const bp = blueprintFixture()
      .place([0, 0, 2], 'create:creative_motor', { facing: 'north' }, scroll(16))
      .place([0, 0, 1], 'create:cogwheel', { axis: 'z' })
      .place([1, 0, 1], 'create:cogwheel', { axis: 'z' })
      .place([0, 0, 0], 'create:encased_chain_drive', { axis: 'z', axis_along_first: 'true', part: 'start' })
      .place([1, 0, 0], 'create:encased_chain_drive', { axis: 'z', axis_along_first: 'true', part: 'end' })
      .toBlueprint()
    const r = evaluate(bp)
    expect(r.ev.issues.some((i) => i.message.startsWith('回転の向きがぶつかっています'))).toBe(true)
    expect(r.speed([0, 0, 1])).toBe(0)
  })

  it('[ST-LINK-BELT] 次の区間の位置（BeltBlock.nextSegmentPosition）', () => {
    const next = (facing: string, slope: string) => nextBeltSegment([5, 5, 5], state('create:belt', { facing, slope, part: 'start' }))
    expect(next('east', 'horizontal')).toEqual([6, 5, 5])
    expect(next('north', 'upward')).toEqual([5, 6, 4])
    expect(next('south', 'downward')).toEqual([5, 4, 6])
    expect(next('east', 'vertical')).toEqual([5, 6, 5])
    expect(next('west', 'vertical')).toEqual([5, 4, 5])
    expect(next('up', 'horizontal')).toBeNull()
  })

  it('[ST-LINK-BELT] 続きが設計図の外なら仮定に載せる。途中がベルトでなければそこで切れる', () => {
    const out = evaluate(
      blueprintFixture({ size: [2, 1, 2] })
        .place([0, 0, 0], 'create:creative_motor', { facing: 'south' }, scroll(16))
        .place([0, 0, 1], 'create:belt', { facing: 'east', slope: 'horizontal', part: 'start' })
        .place([1, 0, 1], 'create:belt', { facing: 'east', slope: 'horizontal', part: 'middle' })
        .toBlueprint(),
    )
    expect(out.speed([1, 0, 1])).toBe(16)
    expect(out.log.list().some((a) => a.message.startsWith('ベルトの続きが設計図の外'))).toBe(true)
    const cut = evaluate(
      blueprintFixture()
        .place([0, 0, 0], 'create:creative_motor', { facing: 'south' }, scroll(16))
        .place([0, 0, 1], 'create:belt', { facing: 'east', slope: 'horizontal', part: 'start' })
        .place([1, 0, 1], 'create:shaft', { axis: 'x' })
        .place([2, 0, 1], 'create:belt', { facing: 'east', slope: 'horizontal', part: 'end' })
        .toBlueprint(),
    )
    expect(cut.speed([2, 0, 1])).toBe(0)
  })

  it('[ST-LINK-CONTROLLER] 真上が水平の軸の大歯車で、コントローラーと軸が違うときだけ。設定値がなければ 16', () => {
    const build = (above: { id: string; axis: string } | null, be?: ReturnType<typeof scroll>) => {
      const f = blueprintFixture()
        .place([0, 0, 0], 'create:creative_motor', { facing: 'east' }, scroll(32))
        .place([1, 0, 0], 'create:rotation_speed_controller', { axis: 'x' }, be)
      if (above) f.place([1, 1, 0], above.id, { axis: above.axis })
      return evaluate(f.toBlueprint())
    }
    expect(build({ id: 'create:large_cogwheel', axis: 'z' }).speed([1, 1, 0])).toBe(16)
    expect(build({ id: 'create:large_cogwheel', axis: 'z' }, scroll(-48)).speed([1, 1, 0])).toBe(-48)
    expect(build({ id: 'create:cogwheel', axis: 'z' }).speed([1, 1, 0])).toBe(0)
    expect(build({ id: 'create:large_cogwheel', axis: 'y' }).speed([1, 1, 0])).toBe(0)
    expect(build({ id: 'create:large_cogwheel', axis: 'x' }).speed([1, 1, 0])).toBe(0)
    expect(build(null).graph.controllers).toEqual([])
  })

  it('[ST-STEP-CONTROLLER] コントローラーの出力が入力に戻る輪は、仮定に載せて計算に入れない', () => {
    // 大歯車の後ろからギアボックスで回して、コントローラーの入力に戻す
    const bp = blueprintFixture()
      .place([0, 0, 0], 'create:rotation_speed_controller', { axis: 'x' }, scroll(32))
      .place([0, 1, 0], 'create:large_cogwheel', { axis: 'z' })
      .place([0, 1, 1], 'create:gearbox', { axis: 'x' })
      .place([0, 0, 1], 'create:gearbox', { axis: 'z' })
      .place([1, 0, 1], 'create:gearbox', { axis: 'y' })
      .place([1, 0, 0], 'create:gearbox', { axis: 'y' })
      .toBlueprint()
    const r = evaluate(bp)
    expect(r.log.list().some((a) => a.message.startsWith('速度コントローラーの出力が入力に戻っている'))).toBe(true)
  })

  it('[ST-SOURCE-WATER-WHEEL] 大きい水車は半分の回転数。FlowScore は −1〜1 に収める', () => {
    const wheel = (id: string, flow: number) =>
      evaluate(blueprintFixture().place([0, 0, 0], id, { axis: 'x', facing: 'east' }, nbt.compound({ FlowScore: nbt.int(flow) })).toBlueprint())
    expect(wheel('create:large_water_wheel', 1).speed([0, 0, 0])).toBe(4)
    expect(wheel('create:water_wheel', -5).speed([0, 0, 0])).toBe(-8)
    expect(wheel('create:water_wheel', 0).speed([0, 0, 0])).toBe(0)
  })

  it('[ST-SOURCE-STEAM-ENGINE] 効率で回転数の段階が変わる。状態がなければ止まっているとみなす', () => {
    const engine = (be: ReturnType<typeof nbt.compound> | undefined) =>
      evaluate(blueprintFixture().place([0, 0, 0], 'create:powered_shaft', { axis: 'x' }, be).toBlueprint())
    const at = (power: number, direction: number, type?: string) =>
      engine(
        nbt.compound({
          EnginePower: nbt.float(power),
          Direction: nbt.int(direction),
          ...(type ? { EngineType: nbt.string(type) } : {}),
        }),
      )
    // 効率 0.5 → k = 1 + min(2, floor(2)) = 3 → 48 RPM、容量 0.5 × 1024 / 3 × 48 = 8192
    const half = at(0.5, -1)
    expect(half.speed([0, 0, 0])).toBe(-48)
    expect(half.network([0, 0, 0]).capacity).toBeCloseTo(8192)
    // 効率 0.2 → k = 1 → 16 RPM。EngineType がなければ蒸気エンジン
    expect(at(0.2, 1).speed([0, 0, 0])).toBe(16)
    // 名前空間のない EngineType もそのまま読む
    expect(at(1, 1, 'steam_engine').network([0, 0, 0]).capacity).toBe(16384)
    expect(at(0, 1).speed([0, 0, 0])).toBe(0)
    expect(at(1, 0).speed([0, 0, 0])).toBe(0)
    const unknown = engine(undefined)
    expect(unknown.speed([0, 0, 0])).toBe(0)
    expect(unknown.log.list().some((a) => a.message.startsWith('蒸気エンジンの状態（EnginePower・Direction）がない'))).toBe(true)
  })

  it('[ST-PORT-SOURCE][ST-PORT-LOAD] 値の足りない仮の入出力、使えない種類、名前付きの入出力', () => {
    const bp = blueprintFixture({ size: [3, 1, 1] })
      .place([0, 0, 0], 'create:shaft', { axis: 'x' })
      .place([1, 0, 0], 'create:shaft', { axis: 'x' })
      .toBlueprint()
    const r = evaluate(bp, [
      { id: 'in', pos: [0, 0, 0], pluginId: 'create-stress', kind: 'rotation-source', params: { rpm: 16 } },
      { id: 'load', pos: [1, 0, 0], pluginId: 'create-stress', kind: 'rotation-load', params: { impact: 2 } },
      { id: 'empty', pos: [1, 0, 0], pluginId: 'create-stress', kind: 'rotation-load', params: {} },
      { id: 'odd', pos: [0, 0, 0], pluginId: 'create-stress', kind: 'heat', params: {} },
      { id: 'named', pos: [2, 0, 0], pluginId: 'create-stress', kind: 'rotation-load', params: { stress: 1 }, label: '炉' },
    ])
    // 容量のない動力源なので、impact の負荷で過負荷になる（応力は止まる前の回転数で数える）
    const net = r.network([0, 0, 0])
    expect(net.capacity).toBe(0)
    expect(net.stress).toBe(2 * 16)
    expect(net.overloaded).toBe(true)
    expect(r.log.list().some((a) => a.message === '仮の入出力の種類 heat は Create の応力では使えないので、計算に入れていない')).toBe(true)
    expect(r.issuesAt([2, 0, 0]).some((m) => m.startsWith('仮の入出力「炉」をつなげません'))).toBe(true)
    // 回転数 0 の仮の動力源は容量も 0
    const still = evaluate(bp, [{ id: 'in', pos: [0, 0, 0], pluginId: 'create-stress', kind: 'rotation-source', params: { capacity: 100 } }])
    expect(still.network([0, 0, 0]).capacity).toBe(0)
  })
})
