import { describe, expect, it } from 'vitest'
import { blueprintFixture, type BlueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { BlockVolume } from '../../domain/blockVolume'
import { Blueprint } from '../../domain/blueprint'
import { nbt, type NbtCompound, type RawNbt } from '../../domain/nbt'
import type { Vec3 } from '../../domain/vec3'
import { AssumptionLog } from '../assumptionLog'
import type { CalcMode } from '../calcPlugin'
import { CaValues } from './createAdditionValues'
import { evaluatePower, wireNodes, type RpmLookup } from './powerNetwork'

const V17 = new CaValues('1.7', null, null)

function wire(offset: Vec3, type = 0): NbtCompound {
  return nbt.compound({ id: nbt.int(0), other: nbt.int(0), type: nbt.int(type), x: nbt.int(offset[0]), y: nbt.int(offset[1]), z: nbt.int(offset[2]) })
}

function nodes(...wires: NbtCompound[]): RawNbt {
  return nbt.compound({ nodes: nbt.list('compound', wires) })
}

function connector(fx: BlueprintFixture, pos: Vec3, mode: string, wires: NbtCompound[] = [], id = 'connector', facing = 'down'): BlueprintFixture {
  return fx.place(pos, `createaddition:${id}`, { facing, mode, rotation: 'none', variant: 'default' }, nodes(...wires))
}

function motor(fx: BlueprintFixture, pos: Vec3, speed = 32, active = 1): BlueprintFixture {
  return fx.place(pos, 'createaddition:electric_motor', { facing: 'east', powered: 'false' }, nbt.compound({ ScrollValue: nbt.int(speed), active: nbt.byte(active) }))
}

/** 発電機（[1,0,0]）→ 取り込む接続（[1,1,0]）→ 電線 → 出す接続（[5,1,0]）→ モーター（[5,0,0]） */
function line(fx = blueprintFixture().dataVersion(3955)): BlueprintFixture {
  fx.place([1, 0, 0], 'createaddition:alternator', { facing: 'east' })
  connector(fx, [1, 1, 0], 'pull', [wire([4, 0, 0])])
  connector(fx, [5, 1, 0], 'push', [wire([-4, 0, 0])])
  return motor(fx, [5, 0, 0])
}

function evaluate(fx: BlueprintFixture, rpm: number | null = 64, opts: { values?: CaValues; mode?: CalcMode; rpmAt?: RpmLookup } = {}) {
  const log = new AssumptionLog()
  const result = evaluatePower(fx.toBlueprint(), opts.values ?? V17, opts.mode ?? 'saved', opts.rpmAt ?? (() => rpm), log)
  return { ...result, log: log.list().map((a) => a.message), messages: result.issues.map((i) => `${i.severity ?? 'error'}:${i.message}`) }
}

describe('電力のネットワーク', () => {
  it('[CA-ALT-OUTPUT] [CA-MOTOR-USE] [CA-WIRE-NODES] [CA-CONNECTOR-MODE] [CA-NET-SUPPLY] [CA-NET-DEMAND] 発電機の電気が電線を通ってモーターに届く', () => {
    const r = evaluate(line())
    expect(r.networks).toHaveLength(1)
    // 64 RPM：480 × 64 / 256 × 0.75 = 90。モーターは 32 RPM で 480 × 32 / 256 = 60
    expect(r.networks[0]).toMatchObject({ supply: 90, demand: 60, hasSource: true })
    expect(r.wires).toBe(1)
    expect(r.issues).toEqual([])
  })

  it('[CA-ALT-OUTPUT] 回転数は整数に切り捨て、符号は見ない。初期値で 256 RPM なら 360 FE/t', () => {
    expect(evaluate(line(), -256).networks[0].supply).toBe(360)
    expect(evaluate(line(), 33.9).networks[0].supply).toBe(Math.floor((480 * 33) / 256 * 0.75))
  })

  it('[CA-MOTOR-USE] 使う量は設定の回転数で決まり、最小は 8 FE/t。止まっているモーターは使わない', () => {
    const slow = blueprintFixture().dataVersion(3955)
    motor(line(slow), [5, 0, 0], -4)
    expect(evaluate(slow).networks[0].demand).toBe(8)
    const off = blueprintFixture().dataVersion(3955)
    motor(line(off), [5, 0, 0], 32, 0)
    expect(evaluate(off).networks[0].demand).toBe(0)
  })

  it('[CA-ALT-IDLE] 回っていない発電機は警告', () => {
    expect(evaluate(line(), 0).messages).toContain('warning:発電機が回っていないので、電気を作りません。')
    expect(evaluate(line(), null).messages).toContain('warning:発電機が回っていないので、電気を作りません。')
  })

  it('[CA-NET-SHORTAGE] 足りないときは、蓄電池がなければエラー', () => {
    const r = evaluate(line(), 16)
    expect(r.networks[0]).toMatchObject({ supply: 22, demand: 60 })
    expect(r.messages).toContain('error:電力 1：電気が足りません（作る 22 FE/t、使う 60 FE/t）。ゲームではモーターが止まります。')
    expect(r.issues.find((i) => i.severity === undefined)?.positions).toEqual([[5, 0, 0]])
  })

  it('[CA-NET-SHORTAGE] [CA-NET-GROUP] 電気を出せる蓄電池があれば警告にして、空になるまでの時間を出す。積んだ蓄電池は1つにする', () => {
    const fx = line()
    fx.place([3, 0, 0], 'createaddition:modular_accumulator', { top: 'false', bottom: 'true' }, nbt.compound({ EnergyContent: nbt.int(1000) }))
    fx.place([3, 1, 0], 'createaddition:modular_accumulator', { top: 'true', bottom: 'false' })
    connector(fx, [3, 0, 1], 'pull', [wire([2, 1, -1])], 'connector', 'north')
    const r = evaluate(fx, 16)
    expect(r.networks).toHaveLength(1)
    expect(r.networks[0]).toMatchObject({ storageCapacity: 4_000_000, storageStored: 1000 })
    // 不足 38 FE/t。4,000,000 / 38 / 20 / 60 ≒ 87.7 分
    expect(r.messages).toContain('warning:電力 1：作る量より 38 FE/t 多く使います。蓄電池が満タンからおよそ 87.7 分で空になり、モーターが止まります。')
    expect(r.log).toContain('隣り合う蓄電池は、1つに積んだものとみなした（生データの Controller は見ていない）')
  })

  it('[CA-MOTOR-NO-POWER] 電気の来ないモーター、電源のないネットワークのモーターは警告', () => {
    const alone = motor(blueprintFixture().dataVersion(3955), [0, 0, 0])
    expect(evaluate(alone).messages).toEqual(['warning:電気モーターに電気が来ていません。接続（電線から出す向き）か発電機をつないでください。'])
    const noSource = connector(motor(blueprintFixture().dataVersion(3955), [0, 0, 0]), [0, 1, 0], 'push')
    expect(evaluate(noSource).messages).toEqual(['warning:電気モーターが、発電機・蓄電池・電源のどれにもつながっていません。'])
  })

  it('[CA-ADJ-OUTPUT] [CA-CREATIVE] 発電機と電源は、隣のモーター・蓄電池へ直接出す', () => {
    const fx = blueprintFixture().dataVersion(3955).place([0, 0, 0], 'createaddition:alternator', { facing: 'north' })
    motor(fx, [1, 0, 0], 256)
    expect(evaluate(fx, 256).networks[0]).toMatchObject({ supply: 360, demand: 480 })
    const creative = blueprintFixture().dataVersion(3955).place([0, 0, 0], 'createaddition:creative_energy')
    motor(creative, [0, 1, 0])
    creative.place([0, 0, 1], 'createaddition:modular_accumulator', { top: 'true', bottom: 'true' })
    const r = evaluate(creative)
    expect(r.networks[0].supply).toBe(Infinity)
    expect(r.issues).toEqual([])
  })

  it('[CA-CONNECTOR-LIMIT] 接続の上限を超える量は、上限までしか通らない', () => {
    const toml = new Map([
      ['wires.small_connector_max_input', 50],
      ['wires.small_connector_max_output', 40],
    ])
    const r = evaluate(line(), 64, { values: new CaValues('1.7', toml, 'config/createaddition-common.toml') })
    expect(r.networks[0]).toMatchObject({ supply: 50, demand: 40 })
    expect(r.messages).toEqual([
      'warning:接続の入力の上限（50 FE/t）より多く作っています。上限までしか電線に入りません。',
      'warning:電気モーターの使う量（60 FE/t）が、接続の出力の上限（40 FE/t）を超えています。',
    ])
  })

  it('[CA-CONNECTOR-SIDE] 接続は facing の隣とだけやりとりする。やりとりしない接続、接続どうし、向きの読めない接続は数えない', () => {
    const fx = blueprintFixture().dataVersion(3955).place([1, 0, 0], 'createaddition:alternator', { facing: 'east' })
    connector(fx, [1, 1, 0], 'pull', [], 'connector', 'up')
    connector(fx, [2, 0, 0], 'none', [], 'connector', 'west')
    connector(fx, [0, 0, 0], 'pull', [], 'connector', 'west')
    connector(fx, [1, 2, 0], 'pull', [], 'connector', 'down')
    fx.place([1, 0, 1], 'createaddition:connector', { facing: 'sideways', mode: 'pull' })
    const r = evaluate(fx)
    // 発電機は、どの接続ともつながらない（facing=up の接続の隣は [1,2,0] の接続、[1,2,0] の隣は [1,1,0] の接続）
    const alternator = r.networkAt.get('1,0,0')!
    expect(r.networks[alternator - 1].devices.map((i) => r.devices[i].pos)).toEqual([[1, 0, 0]])
    expect(r.networks).toHaveLength(6)
  })

  it('[CA-WIRE-NODES] 範囲の外・接続のない位置を指す電線は警告にして、読めない項目は飛ばす', () => {
    const fx = blueprintFixture().dataVersion(3955).size([4, 2, 1])
    connector(fx, [0, 0, 0], 'none', [wire([10, 0, 0]), wire([1, 0, 0]), wire([2, 0, 0])])
    fx.place([1, 0, 0], 'minecraft:stone')
    const r = evaluate(fx)
    expect(r.messages).toEqual([
      'warning:電線の先（10, 0, 0）が設計図の範囲の外なので、計算に入れていません。',
      'warning:電線の先（1, 0, 0）に接続がありません。',
      'warning:電線の先（2, 0, 0）に接続がありません。',
    ])
    const odd = nbt.compound({ nodes: nbt.list('compound', [nbt.compound({ x: nbt.int(1) })]) })
    expect(wireNodes(odd)).toEqual([])
    expect(wireNodes(nbt.compound({ nodes: nbt.list('int', [nbt.int(1)]) }))).toEqual([])
    expect(wireNodes(nbt.compound({ nodes: nbt.int(1) }))).toEqual([])
    expect(wireNodes(null)).toEqual([])
    expect(wireNodes(nbt.compound({ nodes: nbt.list('compound', [nbt.compound({ x: nbt.int(1), y: nbt.int(0), z: nbt.int(0) })]) }))).toEqual([
      { offset: [1, 0, 0], type: 0 },
    ])
  })

  it('[CA-WIRE-LENGTH] [CA-WIRE-LARGE] 長すぎる電線と、大きい接続どうしの銅の電線はエラー', () => {
    const fx = blueprintFixture().dataVersion(3955)
    connector(fx, [0, 0, 0], 'none', [wire([17, 0, 0])])
    connector(fx, [17, 0, 0], 'none', [wire([-17, 0, 0])], 'large_connector')
    connector(fx, [0, 1, 0], 'none', [wire([3, 0, 0], 0)], 'large_connector')
    connector(fx, [3, 1, 0], 'none', [wire([-3, 0, 0], 0)], 'large_connector')
    connector(fx, [0, 2, 0], 'none', [wire([3, 0, 0], 1)], 'large_connector')
    connector(fx, [3, 2, 0], 'none', [], 'large_connector')
    const r = evaluate(fx)
    expect(r.messages).toEqual([
      'error:電線が長すぎます（17 ブロック。上限 16）。ゲームではこの電線を張れません。',
      'error:大きい接続どうしは、銅の電線ではつなげません。金かエレクトラムの電線にしてください。',
    ])
    expect(r.wires).toBe(3)
  })

  it('[CA-LIGHT-USE] [CA-UNKNOWN-BLOCK] 明かり付きの接続は 1 FE/t 使う。知らないブロックは仮定に載せ、圧延機は載せない', () => {
    const fx = line()
    connector(fx, [5, 1, 1], 'none', [wire([0, 0, -1])], 'small_light_connector')
    fx.place([0, 3, 0], 'createaddition:tesla_coil', { facing: 'up', powered: 'false' })
    fx.place([0, 4, 0], 'createaddition:rolling_mill', { facing: 'east' })
    const r = evaluate(fx)
    expect(r.networks[0].demand).toBe(61)
    expect(r.log).toEqual(['createaddition:tesla_coil の電気の出入りは計算に入れていない'])
  })

  it('[CA-MOTOR-ACTIVE] 動かしたときは、active でなく powered で決める', () => {
    const fx = blueprintFixture().dataVersion(3955)
    motor(line(fx), [5, 0, 0], 32, 0)
    const r = evaluate(fx, 64, { mode: 'running' })
    expect(r.networks[0].demand).toBe(60)
    expect(r.log).toEqual(['動かしたときなので、電気モーターは電気が足りるものとして回した（足りるかは電力の計算で見る）'])
  })

  it('[CA-NET-SHORTAGE] モーターがなくても足りなければエラー。位置はネットワークの先頭のブロック', () => {
    const fx = blueprintFixture().dataVersion(3955).place([1, 0, 0], 'createaddition:alternator', { facing: 'east' })
    connector(fx, [1, 1, 0], 'pull', [wire([1, 0, 0])])
    connector(fx, [2, 1, 0], 'none', [wire([-1, 0, 0])], 'small_light_connector')
    const r = evaluate(fx, 0)
    const shortage = r.issues.find((i) => i.severity === undefined)
    expect(shortage?.message).toBe('電力 1：電気が足りません（作る 0 FE/t、使う 1 FE/t）。ゲームではモーターが止まります。')
    expect(shortage?.positions).toHaveLength(1)
  })

  it('リージョンが重なる位置は、先のリージョンのブロックだけを使う', () => {
    const alt = fx3955Alternator()
    const a = new BlockVolume({ name: 'a', size: [2, 1, 1], palette: [alt], cells: Int32Array.of(0, -1) })
    const b = new BlockVolume({ name: 'b', size: [2, 1, 1], offset: [1, 0, 0], palette: [alt], cells: Int32Array.of(0, 0) })
    const r = evaluatePower(new Blueprint('two', 'litematic', 3955, [a, b]), V17, 'saved', () => 64, new AssumptionLog())
    expect(r.devices.map((d) => d.pos)).toEqual([[0, 0, 0], [2, 0, 0]])
  })
})

function fx3955Alternator() {
  return blueprintFixture().place([0, 0, 0], 'createaddition:alternator', { facing: 'east' }).toBlueprint().get([0, 0, 0])!
}
