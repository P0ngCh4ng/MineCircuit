// 「動かしたとき」の動力源（#243。docs/create-stress.md「動かしたとき」）
import { describe, expect, it } from 'vitest'
import { blueprintFixture, entityNbt, state, type BlueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import type { Blueprint } from '../../domain/blueprint'
import { nbt, type RawNbt } from '../../domain/nbt'
import type { Vec3 } from '../../domain/vec3'
import { AssumptionLog } from '../assumptionLog'
import type { CalcMode } from '../calcPlugin'
import { readCreateServerConfig, type CreateServerConfig } from './createConfig'
import { countSails, engineAttachedDirection, glueBoxes } from './createRunning'
import { runCreateStress } from './createStressPlugin'
import { CreateValueResolver } from './createValueResolver'
import { KineticGraph } from './kineticGraph'

function evaluate(bp: Blueprint, mode: CalcMode = 'running', config: CreateServerConfig | null = null) {
  const log = new AssumptionLog()
  const values = new CreateValueResolver(config)
  const graph = KineticGraph.build(bp, [], values, log, mode)
  const ev = graph.evaluate({ maxRotationSpeed: 256, disableStress: false })
  const index = (pos: Vec3): number => {
    const i = graph.nodes.findIndex((n) => n.pos.join() === pos.join())
    if (i < 0) throw new Error(`${pos.join()} にノードがありません`)
    return i
  }
  return {
    ev,
    log,
    speed: (pos: Vec3) => ev.nodes[index(pos)]!.speed,
    capacity: (pos: Vec3) => ev.networks[ev.nodes[index(pos)]!.network]!.capacity,
    notes: () => log.list().map((a) => a.message),
    issues: () => ev.issues.map((i) => i.message),
  }
}

interface BoilerOptions {
  /** 組の一番小さい角 */
  at?: Vec3
  width?: number
  height?: number
  /** 真下に置くブロック（幅 × 幅の全部）。null なら置かない */
  heater?: { id: string; props?: Record<string, string> } | null
  /** 主に Size・Height を書くか。高さの初期値は 4（大きさ 4 → 段階の上限 1） */
  controllerNbt?: boolean
}

/** タンクの組と真下の熱源を置く */
function boiler(f: BlueprintFixture, o: BoilerOptions = {}): BlueprintFixture {
  const [x0, y0, z0] = o.at ?? [1, 1, 1]
  const width = o.width ?? 1
  const height = o.height ?? 4
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      for (let dz = 0; dz < width; dz++) {
        const props = { bottom: String(dy === 0), top: String(dy === height - 1), shape: 'plain' }
        const isController = dx === 0 && dy === 0 && dz === 0 && o.controllerNbt !== false
        const be = isController ? nbt.compound({ Size: nbt.int(width), Height: nbt.int(height) }) : undefined
        f.place([x0 + dx, y0 + dy, z0 + dz], 'create:fluid_tank', props, be)
      }
    }
  }
  const heater = o.heater === undefined ? { id: 'create:blaze_burner', props: { blaze: 'kindled', facing: 'south' } } : o.heater
  if (heater) {
    for (let dx = 0; dx < width; dx++) {
      for (let dz = 0; dz < width; dz++) f.place([x0 + dx, y0 - 1, z0 + dz], heater.id, heater.props ?? {})
    }
  }
  return f
}

/** 壁に付けた蒸気エンジンと、その先の軸。tank の隣に、向き facing で付ける */
function engine(f: BlueprintFixture, tank: Vec3, facing: 'east' | 'west' | 'south' | 'north', shaftAxis: string, be?: RawNbt): Vec3 {
  const v: Record<string, Vec3> = { east: [1, 0, 0], west: [-1, 0, 0], south: [0, 0, 1], north: [0, 0, -1] }
  const d = v[facing]!
  const at: Vec3 = [tank[0] + d[0], tank[1] + d[1], tank[2] + d[2]]
  const shaft: Vec3 = [at[0] + 2 * d[0], at[1] + 2 * d[1], at[2] + 2 * d[2]]
  f.place(at, 'create:steam_engine', { face: 'wall', facing, waterlogged: 'false' }, be)
  f.place(shaft, 'create:powered_shaft', { axis: shaftAxis, waterlogged: 'false' })
  return shaft
}

describe('動かしたとき：見方', () => {
  it('[ST-RUN-MODE] 保存された状態では止まっているボイラーが、動かしたときは回る。ほかの動力源は同じ', () => {
    const f = blueprintFixture({ size: [8, 6, 3] })
    boiler(f)
    const shaft = engine(f, [1, 1, 1], 'east', 'x')
    f.place([6, 1, 1], 'create:creative_motor', { facing: 'up' })
    const bp = f.toBlueprint()
    expect(evaluate(bp, 'saved').speed(shaft)).toBe(0)
    expect(evaluate(bp, 'running').speed(shaft)).toBe(64)
    expect(evaluate(bp, 'saved').speed([6, 1, 1])).toBe(16)
    expect(evaluate(bp, 'running').speed([6, 1, 1])).toBe(16)
  })

  it('[ST-RUN-MODE] プラグインは見方を受け取る。省略は保存された状態', async () => {
    const f = blueprintFixture({ size: [5, 6, 3] })
    boiler(f)
    const shaft = engine(f, [1, 1, 1], 'east', 'x')
    const bp = f.toBlueprint()
    const rpm = (r: Awaited<ReturnType<typeof runCreateStress>>) => r.rotations?.find((x) => x.pos.join() === shaft.join())?.rpm
    expect(rpm(await runCreateStress(bp, { pack: null, ports: [] }))).toBe(0)
    expect(rpm(await runCreateStress(bp, { pack: null, ports: [], mode: 'running' }))).toBe(64)
  })
})

describe('動かしたとき：ボイラー', () => {
  it('[ST-RUN-BOILER-TANK][ST-RUN-BOILER-LEVEL][ST-RUN-BOILER-EFFICIENCY][ST-RUN-BOILER-WATER] 大きさ = 幅 × 幅 × 高さ。段階は大きさ ÷ 4 で抑えられる', () => {
    // 2×2×2（大きさ 8 → 上限 2）、強い熱 2 × 4 = 8 → 段階 2。エンジン 3 台 → 効率 2/3 → k = 3 → 48 RPM
    const f = blueprintFixture({ size: [8, 4, 8] })
    boiler(f, { width: 2, height: 2, heater: { id: 'create:blaze_burner', props: { blaze: 'seething', facing: 'south' } } })
    const a = engine(f, [2, 1, 1], 'east', 'x')
    const b = engine(f, [2, 2, 2], 'east', 'x')
    const c = engine(f, [1, 1, 2], 'south', 'x')
    const r = evaluate(f.toBlueprint())
    for (const p of [a, b]) expect(Math.abs(r.speed(p))).toBe(48)
    expect(Math.abs(r.speed(c))).toBe(48)
    // 容量 = 効率 × 1024 × 16
    expect(r.capacity(a)).toBeCloseTo((2 / 3) * 1024 * 16)
    expect(r.notes()).toContain('ボイラーの水は足りているとみなした')
  })

  it('[ST-RUN-BOILER-TANK] 主の生データがなければ、縦の1列を幅 1 とみなす', () => {
    const f = blueprintFixture({ size: [5, 6, 3] })
    // 1×1×4（大きさ 4 → 上限 1）
    boiler(f, { height: 4, controllerNbt: false })
    const shaft = engine(f, [1, 2, 1], 'east', 'x')
    const r = evaluate(f.toBlueprint())
    expect(r.speed(shaft)).toBe(64)
    expect(r.notes()).toContain('タンクの組の生データ（Size・Height）がないので、縦の1列を幅 1 のボイラーとみなした')
  })

  it('[ST-RUN-BOILER-TANK] 組の一部が設計図の外なら、中の分だけを数え、仮定に載せる', () => {
    // 主は Size 2・Height 3 と書いてあるが、設計図の高さは 2 段分しかない → 中のタンク 4 個（上限 1）
    const f = blueprintFixture({ size: [6, 3, 3] })
    f.place([1, 1, 1], 'create:fluid_tank', { bottom: 'true', top: 'false', shape: 'plain' }, nbt.compound({ Size: nbt.int(2), Height: nbt.int(3) }))
    for (const p of [[2, 1, 1], [1, 2, 1], [2, 2, 1]] as const) f.place(p, 'create:fluid_tank', { bottom: 'false', top: 'false', shape: 'plain' })
    f.place([1, 0, 1], 'create:blaze_burner', { blaze: 'seething', facing: 'south' })
    const shaft = engine(f, [2, 1, 1], 'east', 'x')
    const r = evaluate(f.toBlueprint())
    expect(r.speed(shaft)).toBe(64)
    expect(r.notes()).toContain('タンクの組の一部が設計図の外にあるので、中にある分だけをボイラーの大きさに数えた')
  })

  it('[ST-RUN-BOILER-HEAT] 熱の量。燃料のないバーナーは燃料ありとみなす。弱い熱は強い熱がないときだけ', () => {
    const run = (heater: BoilerOptions['heater'], width = 1) => {
      const f = blueprintFixture({ size: [6, 6, 4] })
      boiler(f, { width, height: 4, heater })
      const shaft = engine(f, [width, 1, 1], 'east', 'x')
      return { r: evaluate(f.toBlueprint()), shaft }
    }
    const burner = (blaze: string) => ({ id: 'create:blaze_burner', props: { blaze, facing: 'south' } })
    // 1 台のエンジンは段階 1 以上で効率 1
    for (const blaze of ['seething', 'kindled', 'fading', 'smouldering']) {
      const { r, shaft } = run(burner(blaze))
      expect(r.speed(shaft)).toBe(64)
      if (blaze === 'smouldering') expect(r.notes()).toContain('燃料のないブレイズバーナーは、燃料を入れたとみなした')
    }
    // 熱がない
    for (const heater of [burner('none'), null, { id: 'minecraft:stone' }, { id: 'minecraft:campfire', props: { lit: 'false' } }]) {
      const { r, shaft } = run(heater)
      expect(r.speed(shaft)).toBe(0)
    }
    // 弱い熱（効率 1/8 → k = 1 → 16 RPM、容量 2048）
    for (const heater of [
      { id: 'minecraft:magma_block' },
      { id: 'minecraft:lava' },
      { id: 'minecraft:fire' },
      { id: 'minecraft:soul_fire' },
      { id: 'minecraft:campfire', props: { lit: 'true' } },
      { id: 'minecraft:soul_campfire', props: { lit: 'true' } },
    ]) {
      const { r, shaft } = run(heater)
      expect(r.speed(shaft)).toBe(16)
      expect(r.capacity(shaft)).toBeCloseTo(2048)
    }
  })

  it('[ST-RUN-BOILER-HEAT][ST-RUN-BOILER-EFFICIENCY] 弱い熱と強い熱が混ざれば、強い熱だけを数える', () => {
    const f = blueprintFixture({ size: [6, 4, 4] })
    // 2×2×2（上限 2）。真下は燃えるバーナー 1 つとマグマ 3 つ → 強い熱 1 → 段階 1、エンジン 2 台 → 効率 1/2 → k = 3
    boiler(f, { width: 2, height: 2, heater: { id: 'minecraft:magma_block' } })
    f.place([1, 0, 1], 'create:blaze_burner', { blaze: 'kindled', facing: 'south' })
    const a = engine(f, [2, 1, 1], 'east', 'x')
    const b = engine(f, [2, 2, 2], 'east', 'x')
    const r = evaluate(f.toBlueprint())
    expect(Math.abs(r.speed(a))).toBe(48)
    expect(Math.abs(r.speed(b))).toBe(48)
    expect(r.capacity(a)).toBeCloseTo(0.5 * 1024 * 16)
  })

  it('[ST-RUN-BOILER-EFFICIENCY] 弱い熱でも、ボイラーが小さすぎて段階の上限が 0 なら止まる', () => {
    const f = blueprintFixture({ size: [5, 3, 3] })
    // 1×1×1（大きさ 1 → 上限 0）
    boiler(f, { height: 1, heater: { id: 'minecraft:magma_block' } })
    const shaft = engine(f, [1, 1, 1], 'east', 'x')
    expect(evaluate(f.toBlueprint()).speed(shaft)).toBe(0)
  })

  it('[ST-RUN-BOILER-ENGINES] 付いている向きがタンクからの向きと違うエンジンは数えない', () => {
    expect(engineAttachedDirection(state('create:steam_engine', { face: 'floor', facing: 'east' }))).toBe('up')
    expect(engineAttachedDirection(state('create:steam_engine', { face: 'ceiling', facing: 'east' }))).toBe('down')
    expect(engineAttachedDirection(state('create:steam_engine', { face: 'wall', facing: 'west' }))).toBe('west')
    expect(engineAttachedDirection(state('create:steam_engine', { face: 'wall' }))).toBeNull()
    const f = blueprintFixture({ size: [6, 6, 3] })
    boiler(f, { height: 4 })
    // タンクの東に、西を向いて付いたエンジン（タンクに付いていない）
    f.place([2, 1, 1], 'create:steam_engine', { face: 'wall', facing: 'west', waterlogged: 'false' })
    f.place([0, 1, 1], 'create:powered_shaft', { axis: 'x', waterlogged: 'false' })
    const r = evaluate(f.toBlueprint())
    expect(r.speed([0, 1, 1])).toBe(0)
    expect(r.notes()).not.toContain('ボイラーの水は足りているとみなした')
  })

  it('[ST-RUN-BOILER-ENGINES] 床と天井のエンジンも数える', () => {
    // 2×2×2（上限 2）。真下は燃えるバーナー 3 つと、天井に付けたエンジン 1 台 → 段階 2、エンジン 2 台 → 効率 1
    const f = blueprintFixture({ size: [4, 9, 4] })
    boiler(f, { at: [1, 3, 1], width: 2, height: 2 })
    f.place([2, 2, 2], 'create:steam_engine', { face: 'ceiling', facing: 'east', waterlogged: 'false' })
    f.place([2, 0, 2], 'create:powered_shaft', { axis: 'x', waterlogged: 'false' })
    f.place([1, 5, 1], 'create:steam_engine', { face: 'floor', facing: 'east', waterlogged: 'false' })
    f.place([1, 7, 1], 'create:powered_shaft', { axis: 'x', waterlogged: 'false' })
    const r = evaluate(f.toBlueprint())
    expect(r.speed([2, 0, 2])).toBe(64)
    expect(r.speed([1, 7, 1])).toBe(64)
  })
})

describe('動かしたとき：蒸気エンジンの軸と向き', () => {
  it('[ST-RUN-STEAM-SHAFT] アプリで置いた shaft もエンジンの軸とみなす。軸がなければ何も回さない', () => {
    const f = blueprintFixture({ size: [5, 6, 3] })
    boiler(f)
    f.place([2, 1, 1], 'create:steam_engine', { face: 'wall', facing: 'east', waterlogged: 'false' })
    f.place([4, 1, 1], 'create:shaft', { axis: 'x', waterlogged: 'false' })
    expect(evaluate(f.toBlueprint()).speed([4, 1, 1])).toBe(64)
    const g = blueprintFixture({ size: [5, 6, 3] })
    boiler(g)
    g.place([2, 1, 1], 'create:steam_engine', { face: 'wall', facing: 'east', waterlogged: 'false' })
    g.place([4, 1, 1], 'create:cogwheel', { axis: 'x', waterlogged: 'false' })
    expect(evaluate(g.toBlueprint()).speed([4, 1, 1])).toBe(0)
  })

  it('[ST-RUN-STEAM-DIRECTION] 向き = エンジンの向きの符号 × 軸が z なら −1 × 反時計回りなら −1。縦の軸は +1', () => {
    const run = (facing: 'east' | 'west' | 'south' | 'north', axis: string, scroll?: number) => {
      const f = blueprintFixture({ size: [7, 6, 7] })
      boiler(f, { at: [3, 1, 3] })
      const shaft = engine(f, [3, 1, 3], facing, axis, scroll === undefined ? undefined : nbt.compound({ ScrollValue: nbt.int(scroll) }))
      return evaluate(f.toBlueprint()).speed(shaft)
    }
    expect(run('east', 'z')).toBe(-64)
    expect(run('west', 'z')).toBe(64)
    expect(run('east', 'z', 1)).toBe(64)
    expect(run('south', 'x')).toBe(64)
    expect(run('north', 'x')).toBe(-64)
    expect(run('north', 'x', 0)).toBe(-64)
    expect(run('east', 'y')).toBe(64)
    expect(run('west', 'y')).toBe(64)
    expect(run('west', 'y', 1)).toBe(-64)
  })

  it('[ST-RUN-STEAM-DIRECTION] 床のエンジンは facing の向きを使う', () => {
    const run = (facing: string) => {
      const f = blueprintFixture({ size: [3, 8, 3] })
      boiler(f, { at: [1, 1, 1], height: 4 })
      f.place([1, 5, 1], 'create:steam_engine', { face: 'floor', facing, waterlogged: 'false' })
      f.place([1, 7, 1], 'create:powered_shaft', { axis: 'x', waterlogged: 'false' })
      return evaluate(f.toBlueprint()).speed([1, 7, 1])
    }
    expect(run('east')).toBe(64)
    expect(run('west')).toBe(-64)
    expect(run('up')).toBe(64)
  })

  it('[ST-RUN-STEAM-FLIP] ほかの動力源と向きがぶつかるエンジンは裏返す', () => {
    const f = blueprintFixture({ size: [7, 6, 3] })
    boiler(f)
    const shaft = engine(f, [1, 1, 1], 'east', 'x')
    // 軸の続きに、逆向き（−16）のクリエイティブモーター
    f.place([5, 1, 1], 'create:shaft', { axis: 'x', waterlogged: 'false' })
    f.place([6, 1, 1], 'create:creative_motor', { facing: 'west' })
    const r = evaluate(f.toBlueprint())
    expect(r.speed(shaft)).toBe(-64)
    expect(r.issues().filter((m) => m.includes('ぶつかって'))).toEqual([])
    expect(r.notes()).toContain('蒸気エンジンの向きを、つながるほかの動力源に合わせて裏返した')
    // 保存された状態の向きは裏返さない（生データの Direction のまま。ぶつかれば問題に出す）
    const g = blueprintFixture({ size: [3, 1, 1] })
      .place([0, 0, 0], 'create:powered_shaft', { axis: 'x' }, nbt.compound({ EnginePower: nbt.float(1), Direction: nbt.int(1) }))
      .place([1, 0, 0], 'create:shaft', { axis: 'x' })
      .place([2, 0, 0], 'create:creative_motor', { facing: 'west' })
    expect(evaluate(g.toBlueprint(), 'saved').issues().some((m) => m.includes('ぶつかって'))).toBe(true)
  })

  it('[ST-RUN-STEAM-FLIP] エンジンどうしは、先のエンジンに合わせる', () => {
    // 東向き（+1）のエンジンの軸 x = 4 と、西向き（−1）のエンジンの軸 x = 5 が、軸どうしでつながる
    const f = blueprintFixture({ size: [9, 6, 3] })
    boiler(f, { at: [1, 1, 1] })
    boiler(f, { at: [8, 1, 1] })
    engine(f, [1, 1, 1], 'east', 'x')
    engine(f, [8, 1, 1], 'west', 'x')
    const r = evaluate(f.toBlueprint())
    expect(Math.abs(r.speed([4, 1, 1]))).toBe(64)
    expect(r.speed([5, 1, 1])).toBe(r.speed([4, 1, 1]))
    expect(r.issues().filter((m) => m.includes('ぶつかって'))).toEqual([])
    expect(r.notes()).toContain('蒸気エンジンの向きを、つながるほかの動力源に合わせて裏返した')
  })

  it('[ST-RUN-STEAM-ONE-PER-SHAFT] 1本の軸に2台なら1台。EnginePos が指すエンジン、なければ位置の小さい方', () => {
    const build = (enginePos?: Vec3) => {
      const f = blueprintFixture({ size: [9, 6, 3] })
      boiler(f, { at: [1, 1, 1] })
      boiler(f, { at: [7, 1, 1] })
      f.place([2, 1, 1], 'create:steam_engine', { face: 'wall', facing: 'east', waterlogged: 'false' })
      f.place([6, 1, 1], 'create:steam_engine', { face: 'wall', facing: 'west', waterlogged: 'false' })
      const be = enginePos
        ? nbt.compound({ EnginePos: nbt.compound({ X: nbt.int(enginePos[0]), Y: nbt.int(enginePos[1]), Z: nbt.int(enginePos[2]) }) })
        : undefined
      f.place([4, 1, 1], 'create:powered_shaft', { axis: 'x', waterlogged: 'false' }, be)
      return evaluate(f.toBlueprint())
    }
    const first = build()
    expect(first.speed([4, 1, 1])).toBe(64)
    expect(first.notes()).toContain('1本の軸に蒸気エンジンが2台以上向いているので、1台だけを使った')
    // EnginePos は軸からエンジンを引いた相対位置（4 − 6 = −2）
    expect(build([-2, 0, 0]).speed([4, 1, 1])).toBe(-64)
    // 指す先にエンジンがなければ、位置の小さい方
    expect(build([5, 0, 0]).speed([4, 1, 1])).toBe(64)
  })
})

describe('動かしたとき：風車', () => {
  /** 軸受（北向き）と、その前の面に並べた帆 */
  function windmill(sails: number, opts: { sailId?: string; scroll?: number; be?: RawNbt } = {}): BlueprintFixture {
    const f = blueprintFixture({ size: [8, 8, 3] })
    const be = opts.be ?? (opts.scroll === undefined ? undefined : nbt.compound({ ScrollValue: nbt.int(opts.scroll) }))
    f.place([0, 0, 2], 'create:windmill_bearing', { facing: 'north' }, be)
    for (let i = 0; i < sails; i++) f.place([i % 8, Math.floor(i / 8), 1], opts.sailId ?? 'create:white_sail', { facing: 'north' })
    return f
  }

  it('[ST-RUN-WINDMILL-SPEED] 帆 8 枚ごとに 1 RPM（1〜16）。反時計回りなら負', () => {
    expect(evaluate(windmill(8).toBlueprint()).speed([0, 0, 2])).toBe(1)
    expect(evaluate(windmill(23).toBlueprint()).speed([0, 0, 2])).toBe(2)
    expect(evaluate(windmill(16, { scroll: 1 }).toBlueprint()).speed([0, 0, 2])).toBe(-2)
    expect(evaluate(windmill(16, { scroll: 0 }).toBlueprint()).speed([0, 0, 2])).toBe(2)
    const r = evaluate(windmill(8).toBlueprint())
    expect(r.notes()).toContain('風車は組み立てて回しているとみなした（帆 8 枚）')
    expect(r.capacity([0, 0, 2])).toBe(512)
  })

  it('[ST-RUN-WINDMILL-SPEED] 帆が足りなければ組み立てられない。下限と比は設定ファイルから読む', () => {
    const r = evaluate(windmill(7).toBlueprint())
    expect(r.speed([0, 0, 2])).toBe(0)
    expect(r.issues()).toContain('帆が足りません（7 枚。8 枚以上が必要）。風車を組み立てられません。')
    const config = readCreateServerConfig('[kinetics]\nminimumWindmillSails = 2\nwindmillSailsPerRPM = 2\n', 'create-server.toml')
    expect(evaluate(windmill(7).toBlueprint(), 'running', config).speed([0, 0, 2])).toBe(3)
    // 最大 16
    expect(evaluate(windmill(40).toBlueprint(), 'running', config).speed([0, 0, 2])).toBe(16)
  })

  it('[ST-RUN-WINDMILL-SAVED] 回したまま保存した風車は、保存された回転数', () => {
    const be = nbt.compound({ Running: nbt.byte(1), LastGenerated: nbt.float(-3) })
    const r = evaluate(windmill(0, { be }).toBlueprint())
    expect(r.speed([0, 0, 2])).toBe(-3)
    expect(r.issues()).toEqual([])
  })

  it('[ST-RUN-WINDMILL-SAILS] 帆は facing の軸と違う向きの隣とつながる。羊毛は接着剤でつながる', () => {
    const glue = (bp: Blueprint) => glueBoxes(bp)
    // 帆どうしは面の中でつながる
    const sails = windmill(8).toBlueprint()
    expect(countSails(sails, [0, 0, 2], 'north', glue(sails))).toBe(8)
    // 帆の向きの軸（z）にある後ろの帆はつながらない
    const behind = windmill(8).place([0, 0, 0], 'create:white_sail', { facing: 'north' }).toBlueprint()
    expect(countSails(behind, [0, 0, 2], 'north', glue(behind))).toBe(8)
    // 羊毛は、接着剤がなければ前の1枚だけ
    const wool = windmill(8, { sailId: 'minecraft:white_wool' }).toBlueprint()
    expect(countSails(wool, [0, 0, 2], 'north', glue(wool))).toBe(1)
    const glued = windmill(8, { sailId: 'minecraft:white_wool' })
      .entity(
        entityNbt([0, 0, 1], 'create:super_glue', nbt.compound({
          From: nbt.list('double', [-0.5, -0.5, -0.5].map((n) => nbt.double(n))),
          To: nbt.list('double', [7.5, 0.5, 0.5].map((n) => nbt.double(n))),
        })),
      )
      .toBlueprint()
    expect(countSails(glued, [0, 0, 2], 'north', glue(glued))).toBe(8)
    // 帆の枠と色付きの帆も数える
    const frames = windmill(4, { sailId: 'create:sail_frame' }).place([4, 0, 1], 'create:red_sail', { facing: 'north' }).toBlueprint()
    expect(countSails(frames, [0, 0, 2], 'north', glue(frames))).toBe(5)
  })

  it('[ST-RUN-WINDMILL-SAILS] スライム・ハチミツは隣とつながる。スライムとハチミツどうしはつながらない', () => {
    const f = blueprintFixture({ size: [4, 1, 3] })
      .place([0, 0, 2], 'create:windmill_bearing', { facing: 'north' })
      .place([0, 0, 1], 'minecraft:slime_block')
      .place([1, 0, 1], 'minecraft:white_wool')
      .place([0, 0, 0], 'minecraft:honey_block')
      .place([1, 0, 0], 'minecraft:red_wool')
    const bp = f.toBlueprint()
    // スライムの隣の羊毛は動く。ハチミツはスライムとつながらないので、その先の羊毛も動かない
    expect(countSails(bp, [0, 0, 2], 'north', [])).toBe(1)
    // 前が空き・空気なら 0
    const empty = blueprintFixture({ size: [1, 1, 3] }).place([0, 0, 2], 'create:windmill_bearing', { facing: 'north' }).toBlueprint()
    expect(countSails(empty, [0, 0, 2], 'north', [])).toBe(0)
    const air = blueprintFixture({ size: [1, 1, 3] })
      .place([0, 0, 2], 'create:windmill_bearing', { facing: 'north' })
      .place([0, 0, 1], 'minecraft:air')
      .toBlueprint()
    expect(countSails(air, [0, 0, 2], 'north', [])).toBe(0)
  })

  it('[ST-RUN-WINDMILL-SAILS] 接着剤の箱は、形の崩れたエンティティを読み飛ばす', () => {
    const bp = blueprintFixture({ size: [2, 1, 2] })
      .entity(entityNbt([0, 0, 0], 'minecraft:item_frame'))
      .entity(entityNbt([0, 0, 0], 'create:super_glue'))
      .entity(nbt.compound({ pos: nbt.list('double', []) }))
      .entity(entityNbt([0, 0, 0], 'create:super_glue', nbt.compound({
        From: nbt.list('int', [0, 0, 0].map((n) => nbt.int(n))),
        To: nbt.list('double', [1, 1, 1].map((n) => nbt.double(n))),
      })))
      .toBlueprint()
    expect(glueBoxes(bp)).toEqual([])
  })

  it('[ST-RUN-WINDMILL-SPEED] 前が設計図の外の軸受は、帆が 0 枚で回らない', () => {
    const bp = blueprintFixture({ size: [1, 1, 1] }).place([0, 0, 0], 'create:windmill_bearing', { facing: 'up' }).toBlueprint()
    const r = evaluate(bp)
    expect(r.speed([0, 0, 0])).toBe(0)
    expect(r.issues()).toContain('帆が足りません（0 枚。8 枚以上が必要）。風車を組み立てられません。')
  })
})
