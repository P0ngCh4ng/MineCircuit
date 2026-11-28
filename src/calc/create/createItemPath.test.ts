import { describe, expect, it } from 'vitest'
import { blueprintFixture, type BlueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { nbt, type NbtCompound } from '../../domain/nbt'
import type { Vec3 } from '../../domain/vec3'
import type { ProcessingRecipe, RecipeBook, RecipeResult } from '../../io/modpack/recipes'
import { AssumptionLog } from '../assumptionLog'
import type { CalcModpack } from '../calcPlugin'
import type { VirtualPort } from '../virtualPort'
import { bottleneckValue, itemPathValues, lineSummary, traceItemPaths, type ItemPathResult } from './createItemPath'
import { recipeTypeId, type CreateRecipeKind } from './createRecipeTypes'
import { runCreateStress } from './createStressPlugin'
import { chooseRecipe, crushingTicks, machineCycleTicks, millstoneTicks, pressCycleTicks, sawTicks } from './createThroughput'
import { blockCenter, throwPath } from './itemMotion'

const recipe = (
  id: string,
  type: CreateRecipeKind,
  items: string[],
  duration: number,
  results: RecipeResult[],
  tags: string[] = [],
): ProcessingRecipe => ({ id, type: recipeTypeId(type), items, tags, duration, results })
const out = (item: string, count = 1, chance = 1): RecipeResult => ({ item, count, chance })

const BOOK: RecipeBook = {
  recipes: [
    recipe('create:milling/wheat', 'milling', ['minecraft:wheat'], 150, [
      out('create:wheat_flour'),
      out('create:wheat_flour', 2, 0.25),
      out('minecraft:wheat_seeds', 1, 0.25),
    ]),
    recipe('create:pressing/iron_ingot', 'pressing', ['minecraft:iron_ingot'], 0, [out('create:iron_sheet')]),
    recipe('create:crushing/iron_ore', 'crushing', [], 250, [out('create:crushed_raw_iron'), out('create:experience_nugget', 1, 0.75)], [
      'forge:ores/iron',
    ]),
    recipe('create:cutting/oak_log', 'cutting', ['minecraft:oak_log'], 50, [out('minecraft:stripped_oak_log')]),
    recipe('create:mixing/andesite_alloy', 'mixing', ['minecraft:andesite', 'minecraft:iron_nugget'], 0, [out('create:andesite_alloy')]),
    recipe('create:compacting/granite', 'compacting', ['minecraft:flint'], 0, [out('minecraft:granite')]),
  ],
  scriptsChangeRecipes: false,
  itemTags: { 'forge:ores/iron': ['minecraft:iron_ore', 'minecraft:deepslate_iron_ore'] },
}

const chest = nbt.compound({ Items: nbt.list('compound') })

let portCount = 0
const port = (pos: Vec3, item: string | null, rate = 1): VirtualPort => ({
  id: `p${++portCount}`,
  pos,
  pluginId: 'create-stress',
  kind: 'item-input',
  params: { rate },
  ...(item ? { items: { item } } : {}),
})

/** 回転数の表（"x,y,z" → RPM）で物の通り道をたどる */
function trace(
  fx: BlueprintFixture,
  ports: VirtualPort[],
  speeds: Record<string, number> = {},
  book: RecipeBook | null = BOOK,
): { result: ItemPathResult; log: AssumptionLog } {
  const log = new AssumptionLog()
  const result = traceItemPaths(ports, {
    bp: fx.toBlueprint(),
    recipes: book,
    log,
    rpmAt: (p) => speeds[p.join(',')] ?? null,
    bulkPressing: false,
  })
  return { result, log }
}

const at = (r: ItemPathResult, pos: string) => r.records.find((x) => x.pos.join(',') === pos)
const rateOf = (r: ItemPathResult, pos: string, item: string) =>
  at(r, pos)?.arrivals.filter((a) => a.item === item).reduce((s, a) => s + a.rate, 0) ?? 0
const sinkOf = (r: ItemPathResult, pos: string, item: string) => at(r, pos)?.sinks.find((s) => s.item === item)?.rate ?? 0
const messages = (log: AssumptionLog) => log.list().map((a) => a.message)

/** x = from..to の水平のベルト（facing の向きに start → end） */
function belt(fx: BlueprintFixture, y: number, z: number, xs: number[], facing: 'east' | 'west'): BlueprintFixture {
  xs.forEach((x, i) => {
    const part = i === 0 ? 'start' : i === xs.length - 1 ? 'end' : 'middle'
    fx.place([x, y, z], 'create:belt', { facing, slope: 'horizontal', part })
  })
  return fx
}

describe('chooseRecipe（タグと、合うレシピが2つ以上のとき）', () => {
  it('[TP-RECIPE-TAGS] 材料はタグでも照らす', () => {
    const choice = chooseRecipe('crushing', ['minecraft:deepslate_iron_ore'], BOOK)
    expect(choice.recipe?.id).toBe('create:crushing/iron_ore')
    expect(choice.duration).toEqual({ value: 250, source: 'modpack', note: 'create:crushing/iron_ore' })
    expect(choice.assumption).toBeNull()
  })

  it('[TP-RECIPE-TIE] 合うレシピが2つ以上なら ID の名前順で最初のものを使い、仮定に載せる', () => {
    const book: RecipeBook = {
      ...BOOK,
      recipes: [
        recipe('create:milling/z_wheat', 'milling', ['minecraft:wheat'], 50, []),
        recipe('create:milling/a_wheat', 'milling', [], 70, [], ['c:crops/wheat']),
      ],
      itemTags: { 'c:crops/wheat': ['minecraft:wheat'] },
    }
    const choice = chooseRecipe('milling', ['minecraft:wheat'], book)
    expect(choice.recipe?.id).toBe('create:milling/a_wheat')
    expect(choice.assumption).toBe('石臼の材料 minecraft:wheat に合うレシピが 2 つあるので、ID の名前順で最初の create:milling/a_wheat を使った')
  })
})

describe('物の通り道', () => {
  it('[TP-PATH-RECIPE][TP-RECIPE-BY-PATH][TP-BLOCK-MILLSTONE] 例：小麦 → 石臼 → 小麦粉 → シュート → ベルト → デポに溜まる', () => {
    const fx = blueprintFixture()
      .place([1, 3, 0], 'create:millstone')
      .place([1, 2, 0], 'create:chute', { facing: 'down' })
      .place([3, 1, 0], 'create:depot')
    belt(fx, 1, 0, [1, 2], 'east')
    // 回転数 < 0、軸が X なので正の向き（east）に進む
    const { result } = trace(fx, [port([1, 3, 0], 'minecraft:wheat', 1)], { '1,3,0': 256, '1,1,0': -32, '2,1,0': -32 })
    expect(rateOf(result, '1,3,0', 'minecraft:wheat')).toBe(1)
    const mill = at(result, '1,3,0')!
    expect(mill.recipes[0]!.outputs).toEqual([
      { item: 'create:wheat_flour', rate: 1.5, source: 'virtual' },
      { item: 'minecraft:wheat_seeds', rate: 0.25, source: 'virtual' },
    ])
    expect(rateOf(result, '1,2,0', 'create:wheat_flour')).toBe(1.5)
    expect(rateOf(result, '1,1,0', 'create:wheat_flour')).toBe(1.5)
    expect(at(result, '3,1,0')?.arrivals[0]).toEqual({ item: 'create:wheat_flour', rate: 1.5, from: [2, 1, 0], source: 'virtual' })
    expect(sinkOf(result, '3,1,0', 'create:wheat_flour')).toBe(1.5)
    expect(sinkOf(result, '3,1,0', 'minecraft:wheat_seeds')).toBe(0.25)
    expect(result.itemsAt([1, 3, 0])).toEqual(['minecraft:wheat'])

    const values = itemPathValues(mill)
    expect(values.find((v) => v.label === '届く物')?.value).toEqual({
      value: 'minecraft:wheat 1 個/秒（物の入口から）',
      source: 'virtual',
    })
    expect(values.find((v) => v.label === 'レシピ')?.value.value).toBe(
      'create:milling/wheat（minecraft:wheat → create:wheat_flour 1.5 個/秒、minecraft:wheat_seeds 0.25 個/秒）',
    )
    expect(itemPathValues(at(result, '3,1,0')!).find((v) => v.label === '溜まる物')?.value.value).toBe(
      'create:wheat_flour 1.5 個/秒、minecraft:wheat_seeds 0.25 個/秒',
    )
  })

  it('[TP-BLOCK-BELT] ベルト：進む向きは (回転数 < 0) XOR (軸が X) なら負の向き。端の先の入れ物に渡す', () => {
    const fx = () =>
      belt(blueprintFixture().place([0, 0, 0], 'minecraft:chest', chest).place([4, 0, 0], 'minecraft:chest', chest), 0, 0, [1, 2, 3], 'east')
    const speeds = (rpm: number) => ({ '1,0,0': rpm, '2,0,0': rpm, '3,0,0': rpm })
    // 軸が X で回転数 > 0 なら負の向き（west）
    const west = trace(fx(), [port([2, 0, 0], 'minecraft:stone')], speeds(32)).result
    expect(sinkOf(west, '0,0,0', 'minecraft:stone')).toBe(1)
    expect(at(west, '4,0,0')).toBeUndefined()
    const east = trace(fx(), [port([2, 0, 0], 'minecraft:stone')], speeds(-32)).result
    expect(sinkOf(east, '4,0,0', 'minecraft:stone')).toBe(1)

    // 軸が Z なら回転数 > 0 で正の向き（south）
    const south = blueprintFixture()
      .place([0, 0, 0], 'create:belt', { facing: 'south', slope: 'horizontal', part: 'start' })
      .place([0, 0, 1], 'create:belt', { facing: 'south', slope: 'horizontal', part: 'end' })
      .place([0, 0, 2], 'minecraft:barrel', chest)
    expect(sinkOf(trace(south, [port([0, 0, 0], 'minecraft:stone')], { '0,0,0': 8, '0,0,1': 8 }).result, '0,0,2', 'minecraft:stone')).toBe(1)
  })

  it('[TP-PATH-MOTIONS][TP-MOTION-SHAPE] 物の動き：ベルトは区間ごとに回転数 ÷ 24 の速さで、端の先へもベルトの速さで動く（#231、#233）', () => {
    const fx = belt(blueprintFixture().place([4, 0, 0], 'minecraft:chest', chest), 0, 0, [1, 2, 3], 'east')
    const { result } = trace(fx, [port([1, 0, 0], 'minecraft:stone', 2)], { '1,0,0': -48, '2,0,0': -48, '3,0,0': -48 })
    expect(result.moves).toEqual([
      { from: [1, 0, 0], to: [2, 0, 0], item: 'minecraft:stone', rate: 2, seconds: 0.5, hold: 0 },
      { from: [2, 0, 0], to: [3, 0, 0], item: 'minecraft:stone', rate: 2, seconds: 0.5, hold: 0 },
      { from: [3, 0, 0], to: [4, 0, 0], item: 'minecraft:stone', rate: 2, seconds: 0.5, hold: 0 },
    ])
  })

  it('[TP-MOTION-BELT-MACHINE] 物の動き：上のプレスで変わった物が先へ進み、機械へ向かう動きは出さない。プレスの下で1回分止まる（#231、#233）', () => {
    const fx = belt(blueprintFixture().place([1, 2, 0], 'create:mechanical_press', { facing: 'north' }), 0, 0, [0, 1, 2], 'east')
    const speeds = { '0,0,0': -24, '1,0,0': -24, '2,0,0': -24, '1,2,0': 64 }
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:iron_ingot')], speeds)
    expect(result.moves.map((m) => [m.from.join(','), m.to.join(','), m.item])).toEqual([
      ['0,0,0', '1,0,0', 'minecraft:iron_ingot'],
      ['1,0,0', '2,0,0', 'create:iron_sheet'],
    ])
    expect(result.moves[0]!.hold).toBe(pressCycleTicks(64)! / 20)
    expect(result.moves[1]!.hold).toBe(0)
  })

  it('[TP-MOTION-MILLSTONE][TP-MOTION-CHUTE] 物の動き：石臼は物の入口から入った所で止まり、シュートは 4 マス/秒、ベルトの先のデポへはベルトの速さ（#233）', () => {
    const fx = blueprintFixture()
      .place([1, 3, 0], 'create:millstone')
      .place([1, 2, 0], 'create:chute', { facing: 'down' })
      .place([3, 1, 0], 'create:depot')
    belt(fx, 1, 0, [1, 2], 'east')
    const { result } = trace(fx, [port([1, 3, 0], 'minecraft:wheat', 1)], { '1,3,0': 256, '1,1,0': -32, '2,1,0': -32 })
    const flour = (from: string, to: string) =>
      result.moves.find((m) => m.from.join(',') === from && m.to.join(',') === to && m.item === 'create:wheat_flour')
    expect(result.moves.find((m) => m.item === 'minecraft:wheat')).toMatchObject({ from: [1, 3, 0], to: [1, 3, 0], seconds: 0, hold: millstoneTicks(256, 150)! / 20 })
    expect(flour('1,3,0', '1,2,0')?.seconds).toBe(0)
    expect(flour('1,2,0', '1,1,0')?.seconds).toBe(0.25)
    expect(flour('1,1,0', '2,1,0')?.seconds).toBe(0.75)
    expect(flour('2,1,0', '3,1,0')?.seconds).toBe(0.75)
  })

  it('[TP-MOTION-ARM] 物の動き：機械アームは取る点から置く点へ、移動1回分で弧を描いて運ぶ（#233）', () => {
    const points = nbt.list('compound', [
      nbt.compound({ Pos: nbt.intArray([-1, 0, 0]), Mode: nbt.string('TAKE') }),
      nbt.compound({ Pos: nbt.intArray([1, 0, 0]), Mode: nbt.string('DEPOSIT') }),
    ])
    const fx = blueprintFixture()
      .place([1, 0, 0], 'create:mechanical_arm', nbt.compound({ InteractionPoints: points }))
      .place([0, 0, 0], 'minecraft:chest', chest)
      .place([2, 0, 0], 'create:depot')
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:stone')], { '1,0,0': 64 })
    expect(result.moves).toHaveLength(1)
    const move = result.moves[0]!
    expect(move).toMatchObject({ from: [0, 0, 0], to: [2, 0, 0], seconds: 16 / 20 })
    expect(move.path![0]!.pos).toEqual([0.5, 0.5, 0.5])
    expect(move.path![move.path!.length - 1]!.pos).toEqual([2.5, 0.5, 0.5])
    // 真ん中ではアームの上を通る
    expect(Math.max(...move.path!.map((p) => p.pos[1]))).toBeGreaterThan(1)
    // 届く物の「どこから」はアームのまま
    expect(at(result, '2,0,0')?.arrivals[0]?.from).toEqual([1, 0, 0])
  })

  it('[TP-MOTION-ARM][TP-MOTION-BELT-MACHINE] 物の動き：機械アームがプレスの下のデポやホッパーに置いた物は、アームが運ぶ動きの先で止まる', () => {
    const points = (deposit: Vec3) =>
      nbt.compound({
        InteractionPoints: nbt.list('compound', [
          nbt.compound({ Pos: nbt.intArray([-1, 0, 0]), Mode: nbt.string('TAKE') }),
          nbt.compound({ Pos: nbt.intArray(deposit), Mode: nbt.string('DEPOSIT') }),
        ]),
      })
    const press = blueprintFixture()
      .place([1, 0, 0], 'create:mechanical_arm', points([1, 0, 0]))
      .place([0, 0, 0], 'minecraft:chest', chest)
      .place([2, 0, 0], 'create:depot')
      .place([2, 2, 0], 'create:mechanical_press', { facing: 'north' })
    const pressed = trace(press, [port([0, 0, 0], 'minecraft:iron_ingot')], { '1,0,0': 64, '2,2,0': 64 }).result
    const ingot = pressed.moves.filter((m) => m.item === 'minecraft:iron_ingot')
    expect(ingot.map((m) => [m.from.join(','), m.to.join(',')])).toEqual([['0,0,0', '2,0,0']])
    expect(ingot[0]!.hold).toBe(pressCycleTicks(64)! / 20)

    const hopper = blueprintFixture()
      .place([1, 0, 0], 'create:mechanical_arm', points([1, 0, 0]))
      .place([0, 0, 0], 'minecraft:chest', chest)
      .place([2, 0, 0], 'minecraft:hopper', { facing: 'down', enabled: 'true' })
    const held = trace(hopper, [port([0, 0, 0], 'minecraft:stone')], { '1,0,0': 64 }).result
    expect(held.moves.map((m) => [m.from.join(','), m.to.join(','), m.hold])).toEqual([['0,0,0', '2,0,0', 8 / 20]])

    // ベルトの上のプレス：アームが置いた区間で止まり、変わった物が先へ進む
    const onBelt = belt(
      blueprintFixture()
        .place([1, 0, 0], 'create:mechanical_arm', points([1, 0, 0]))
        .place([0, 0, 0], 'minecraft:chest', chest)
        .place([2, 2, 0], 'create:mechanical_press', { facing: 'north' }),
      0,
      0,
      [2, 3],
      'east',
    )
    const belted = trace(onBelt, [port([0, 0, 0], 'minecraft:iron_ingot')], { '1,0,0': 64, '2,0,0': -24, '3,0,0': -24, '2,2,0': 64 }).result
    const carried = belted.moves.find((m) => m.item === 'minecraft:iron_ingot')!
    expect([carried.from, carried.to]).toEqual([[0, 0, 0], [2, 0, 0]])
    expect(carried.hold).toBe(pressCycleTicks(64)! / 20)
  })

  it('[TP-MOTION-FUNNEL-EXTRACT][TP-MOTION-THROWN] 物の動き：水平の取り出すファンネルの下が空気なら、ファンネルの下から放物線で落ちる（#233、#253）', () => {
    const fx = blueprintFixture({ size: [4, 4, 3] })
      .place([3, 3, 0], 'minecraft:chest', chest)
      .place([3, 3, 1], 'create:andesite_funnel', { facing: 'south', extracting: 'true', powered: 'false' })
      .place([3, 0, 1], 'create:depot')
    const { result } = trace(fx, [port([3, 3, 0], 'minecraft:stone')])
    const drop = result.moves.find((m) => m.to.join(',') === '3,0,1')!
    expect(drop.from).toEqual([3, 3, 1])
    expect(drop.path![0]!.pos).toEqual([3.5, 3.5, 1.5])
    expect(drop.path![1]!.pos).toEqual([3.5, 2.5, 1.5])
    expect(drop.path![drop.path!.length - 1]!.pos).toEqual([3.5, 0.5, 1.5])
    // ファンネルの下のマスから 2 ブロック落ちるのに、速さ 0 から 1 tick に 0.04 ずつ加速して（0.98 を掛けながら）10 tick
    expect(drop.seconds).toBeCloseTo(10 / 20)
    // 口の前（南）のマスには出さない
    expect(result.moves.some((m) => m.to[2] === 2)).toBe(false)
    // 入れ物から取り出すファンネルへは、移動しない受け渡し
    expect(result.moves.find((m) => m.to.join(',') === '3,3,1')?.seconds).toBe(0)
  })

  it('[TP-EJECTOR] イジェクター：生データの距離のマスへ放物線で投げる。距離がなければ横 1 と仮定、止まっていれば投げない（#233）', () => {
    const fx = blueprintFixture({ size: [5, 4, 2] })
      .place([0, 0, 0], 'create:weighted_ejector', { facing: 'east' }, nbt.compound({ HorizontalDistance: nbt.int(3), VerticalDistance: nbt.int(1) }))
      .place([3, 1, 0], 'minecraft:chest', chest)
      .place([0, 0, 1], 'create:weighted_ejector', { facing: 'east' })
      .place([1, 0, 1], 'create:depot')
    const { result, log } = trace(fx, [port([0, 0, 0], 'minecraft:stone'), port([0, 0, 1], 'minecraft:dirt')], { '0,0,0': 32, '0,0,1': 32 })
    expect(sinkOf(result, '3,1,0', 'minecraft:stone')).toBe(1)
    const thrown = result.moves.find((m) => m.to.join(',') === '3,1,0')!
    expect(thrown.from).toEqual([0, 0, 0])
    expect(thrown.path![0]!.pos).toEqual([0.5, 1, 0.5])
    const end = thrown.path![thrown.path!.length - 1]!.pos
    expect(end[0]).toBeCloseTo(3.5)
    expect(end[1]).toBeCloseTo(1.5)
    expect(Math.max(...thrown.path!.map((p) => p.pos[1]))).toBeGreaterThan(2.5)
    expect(thrown.seconds).toBeGreaterThan(0.5)
    expect(sinkOf(result, '1,0,1', 'minecraft:dirt')).toBe(1)
    expect(messages(log)).toContain('イジェクターの投げる距離が分からないので、横に 1 ブロック先へ投げるとした')

    const stopped = trace(fx, [port([0, 0, 0], 'minecraft:stone')], { '0,0,0': 0 }).result
    expect(at(stopped, '0,0,0')?.notes).toContain('止まっているので、物を投げない')
    expect(at(stopped, '3,1,0')).toBeUndefined()
  })

  it('[TP-BRASS-TUNNEL] 真鍮のトンネル：組の出口へ 10 tick 待って等しく分ける。「近い方」なら自分の先へ全部。端の横の口にも分ける（#233）', () => {
    const fx = () => {
      const f = blueprintFixture({ size: [4, 2, 3] })
      belt(f, 0, 1, [0, 1, 2], 'east')
      belt(f, 0, 2, [0, 1, 2], 'east')
      return f
        .place([3, 0, 1], 'minecraft:chest', chest)
        .place([3, 0, 2], 'minecraft:chest', chest)
        .place([1, 1, 2], 'create:brass_tunnel')
    }
    const speeds = { '0,0,1': -24, '1,0,1': -24, '2,0,1': -24, '0,0,2': -24, '1,0,2': -24, '2,0,2': -24 }
    const split = trace(fx().place([1, 1, 1], 'create:brass_tunnel'), [port([0, 0, 1], 'minecraft:stone')], speeds).result
    expect(sinkOf(split, '3,0,1', 'minecraft:stone')).toBe(0.5)
    expect(sinkOf(split, '3,0,2', 'minecraft:stone')).toBe(0.5)
    expect(split.moves.find((m) => m.to.join(',') === '1,0,1')?.hold).toBe(0.5)
    // 隣のベルトへは、トンネルの区間から隣のベルトの次の区間へ動く
    expect(split.moves.some((m) => m.from.join(',') === '1,0,1' && m.to.join(',') === '2,0,2')).toBe(true)

    const nearest = trace(
      fx().place([1, 1, 1], 'create:brass_tunnel', nbt.compound({ ScrollValue: nbt.int(4) })),
      [port([0, 0, 1], 'minecraft:stone')],
      speeds,
    ).result
    expect(sinkOf(nearest, '3,0,1', 'minecraft:stone')).toBe(1)
    expect(sinkOf(nearest, '3,0,2', 'minecraft:stone')).toBe(0)

    // 組の端（北）の横に入れ物があれば、そこにも分ける
    const side = trace(fx().place([1, 1, 1], 'create:brass_tunnel').place([1, 0, 0], 'create:depot'), [port([0, 0, 1], 'minecraft:stone', 3)], speeds).result
    expect(sinkOf(side, '3,0,1', 'minecraft:stone')).toBe(1)
    expect(sinkOf(side, '3,0,2', 'minecraft:stone')).toBe(1)
    expect(sinkOf(side, '1,0,0', 'minecraft:stone')).toBe(1)
  })

  it('[TP-ANDESITE-TUNNEL] 安山岩のトンネル：1個ずつ流れるとして、横へは分けずに素通りし、横に口があれば仮定に載せる（#233）', () => {
    const fx = belt(blueprintFixture({ size: [4, 2, 2] }), 0, 1, [0, 1, 2], 'east')
      .place([3, 0, 1], 'minecraft:chest', chest)
      .place([1, 1, 1], 'create:andesite_tunnel')
      .place([1, 0, 0], 'create:depot')
    const { result, log } = trace(fx, [port([0, 0, 1], 'minecraft:stone')], { '0,0,1': -24, '1,0,1': -24, '2,0,1': -24 })
    expect(sinkOf(result, '3,0,1', 'minecraft:stone')).toBe(1)
    expect(at(result, '1,0,0')).toBeUndefined()
    expect(messages(log)).toContain('物は1個ずつ流れるとしたので、安山岩のトンネルは横へ分けずに素通りする')
  })

  it('[TP-HOPPER] ホッパー：上の入れ物から吸い込み、8 tick 止まって facing の先へ。止まっていれば溜まる。2.5 個/秒を超えたら出す（#233）', () => {
    const fx = (enabled: string) =>
      blueprintFixture({ size: [2, 2, 1] })
        .place([0, 1, 0], 'minecraft:chest', chest)
        .place([0, 0, 0], 'minecraft:hopper', { facing: 'east', enabled })
        .place([1, 0, 0], 'minecraft:chest', chest)
    const { result } = trace(fx('true'), [port([0, 1, 0], 'minecraft:stone', 3)])
    expect(sinkOf(result, '1,0,0', 'minecraft:stone')).toBe(3)
    expect(result.moves.find((m) => m.to.join(',') === '0,0,0')).toMatchObject({ from: [0, 1, 0], seconds: 0, hold: 0.4 })
    expect(at(result, '0,0,0')?.notes).toContain('ホッパーが送れるのは 2.5 個/秒まで。届く数はこれより多い')

    const off = trace(fx('false'), [port([0, 1, 0], 'minecraft:stone')]).result
    expect(sinkOf(off, '0,0,0', 'minecraft:stone')).toBe(1)
    expect(at(off, '1,0,0')).toBeUndefined()
  })

  it('[TP-ITEM-DRAIN] アイテムドレイン：入った面から反対の面へ 2.5 ブロック/秒で通り抜け、液体のバケツは 20 tick 止まって空のバケツになる（#233・#235）', () => {
    const fx = belt(blueprintFixture({ size: [4, 1, 1] }), 0, 0, [0, 1], 'east')
      .place([2, 0, 0], 'create:item_drain')
      .place([3, 0, 0], 'minecraft:chest', chest)
    const { result, log } = trace(fx, [port([0, 0, 0], 'minecraft:water_bucket')], { '0,0,0': -24, '1,0,0': -24 })
    expect(sinkOf(result, '3,0,0', 'minecraft:bucket')).toBe(1)
    expect(result.moves.find((m) => m.to.join(',') === '3,0,0')?.seconds).toBe(0.4)
    expect(result.moves.find((m) => m.to.join(',') === '2,0,0')?.hold).toBe(1)
    expect(at(result, '2,0,0')?.recipes[0]).toMatchObject({
      type: 'emptying',
      input: 'minecraft:water_bucket',
      outputs: [{ item: 'minecraft:bucket', rate: 1, source: 'virtual' }],
    })
    expect(at(result, '2,0,0')?.recipes[0]?.choice.duration).toEqual({ value: 20, source: 'builtin', note: 'バケツの液体を抜く' })
    expect(messages(log)).toEqual([])
    // 液体の入っていない物は、止まらずに通り抜ける
    const stone = trace(fx, [port([0, 0, 0], 'minecraft:stone')], { '0,0,0': -24, '1,0,0': -24 })
    expect(sinkOf(stone.result, '3,0,0', 'minecraft:stone')).toBe(1)
    expect(stone.result.moves.find((m) => m.to.join(',') === '2,0,0')?.hold ?? 0).toBe(0)
  })

  it('[TP-SPOUT] スパウト：2段上のスパウトの下で 20 tick 止まり、タンクの水を入れたガラス瓶は水入り瓶になる（#233・#235）', () => {
    const water = nbt.compound({
      Tanks: nbt.list('compound', [
        nbt.compound({ TankContent: nbt.compound({ FluidName: nbt.string('minecraft:water'), Amount: nbt.int(1000) }) }),
      ]),
    })
    const fx = belt(blueprintFixture({ size: [4, 3, 1] }), 0, 0, [0, 1, 2], 'east')
      .place([1, 2, 0], 'create:spout', {}, water)
      .place([3, 0, 0], 'minecraft:chest', chest)
    const speeds = { '0,0,0': -24, '1,0,0': -24, '2,0,0': -24 }
    const { result, log } = trace(fx, [port([0, 0, 0], 'minecraft:glass_bottle')], speeds)
    expect(sinkOf(result, '3,0,0', 'minecraft:potion')).toBe(1)
    expect(result.moves.find((m) => m.to.join(',') === '1,0,0')?.hold).toBe(1)
    expect(rateOf(result, '1,2,0', 'minecraft:glass_bottle')).toBe(1)
    expect(at(result, '1,2,0')?.recipes[0]).toMatchObject({ type: 'filling', input: 'minecraft:glass_bottle' })
    expect(messages(log)).toEqual([])
    // 液体を入れられない物は、止まらずに通る
    const stone = trace(fx, [port([0, 0, 0], 'minecraft:stone')], speeds)
    expect(sinkOf(stone.result, '3,0,0', 'minecraft:stone')).toBe(1)
    expect(stone.result.moves.find((m) => m.to.join(',') === '1,0,0')?.hold ?? 0).toBe(0)
    expect(at(stone.result, '1,2,0')?.notes).toContain('minecraft:stone には minecraft:water を入れられないので、物は変わらずに通る')
  })

  it('[TP-PATH-MOTIONS] 物の動き：物の入口がなければ何も出さない（#231）', () => {
    const fx = belt(blueprintFixture(), 0, 0, [0, 1], 'east')
    expect(trace(fx, [], { '0,0,0': -24, '1,0,0': -24 }).result.moves).toEqual([])
  })

  it('[TP-BLOCK-BELT] ベルト：坂をたどり、端の先が空気なら下に落ちるとして仮定に載せる', () => {
    const fx = blueprintFixture({ size: [5, 3, 1] })
      .place([1, 0, 0], 'create:belt', { facing: 'east', slope: 'horizontal', part: 'start' })
      .place([2, 0, 0], 'create:belt', { facing: 'east', slope: 'upward', part: 'middle' })
      .place([3, 1, 0], 'create:belt', { facing: 'east', slope: 'horizontal', part: 'end' })
      .place([0, 0, 0], 'minecraft:chest', chest)
      .place([4, 0, 0], 'minecraft:chest', chest)
    const speeds = (rpm: number) => ({ '1,0,0': rpm, '2,0,0': rpm, '3,1,0': rpm })
    // 東へ：端（3,1,0）の先（4,1,0）は空気なので、下の（4,0,0）に落ちる
    const up = trace(fx, [port([1, 0, 0], 'minecraft:stone')], speeds(-16))
    expect(sinkOf(up.result, '4,0,0', 'minecraft:stone')).toBe(1)
    expect(at(up.result, '4,0,0')?.sinks[0]?.source).toBe('assumed')
    expect(messages(up.log)).toContain('出す先（(4, 1, 0)）が空気なので、物は下の (4, 0, 0) に落ちるとした')
    // 西へ：上の端から坂を下りて（0,0,0）へ
    const down = trace(fx, [port([3, 1, 0], 'minecraft:stone')], speeds(16))
    expect(sinkOf(down.result, '0,0,0', 'minecraft:stone')).toBe(1)
  })

  it('[TP-PATH-STOPPED] ベルト：止まっていればそこで止まる', () => {
    const fx = belt(blueprintFixture().place([3, 0, 0], 'minecraft:chest', chest), 0, 0, [0, 1, 2], 'east')
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:stone')], { '0,0,0': 0, '1,0,0': 0, '2,0,0': 0 })
    expect(rateOf(result, '0,0,0', 'minecraft:stone')).toBe(1)
    expect(at(result, '0,0,0')?.notes).toContain('止まっているので、物はここで止まる')
    expect(at(result, '3,0,0')).toBeUndefined()
  })

  it('[TP-BLOCK-BELT-MACHINE] ベルトの上の機械：2段上のプレスで押し、デプロイヤーは通すだけ。間にブロックがあれば処理しない', () => {
    const fx = belt(blueprintFixture().place([4, 0, 0], 'minecraft:chest', chest), 0, 0, [0, 1, 2, 3], 'east')
      .place([1, 2, 0], 'create:mechanical_press', { facing: 'north' })
      .place([2, 2, 0], 'create:deployer', { facing: 'down' })
      .place([3, 1, 0], 'minecraft:stone')
      .place([3, 2, 0], 'create:mechanical_press', { facing: 'north' })
    const speeds = { '0,0,0': -32, '1,0,0': -32, '2,0,0': -32, '3,0,0': -32, '1,2,0': 64, '2,2,0': 64, '3,2,0': 64 }
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:iron_ingot', 0.5)], speeds)
    expect(rateOf(result, '1,2,0', 'minecraft:iron_ingot')).toBe(0.5)
    expect(at(result, '1,2,0')?.recipes[0]?.choice.recipe?.id).toBe('create:pressing/iron_ingot')
    expect(rateOf(result, '2,2,0', 'create:iron_sheet')).toBe(0.5)
    // 間に石があるので、3つ目のプレスには届かない
    expect(at(result, '3,2,0')).toBeUndefined()
    expect(sinkOf(result, '4,0,0', 'create:iron_sheet')).toBe(0.5)
  })

  it('[TP-BLOCK-BELT-FUNNEL] ベルトのファンネル：pulling なら下を通る物を取り込み、facing の反対側の入れ物に入れる', () => {
    const fx = belt(blueprintFixture().place([4, 0, 0], 'minecraft:chest', chest), 0, 0, [0, 1, 2, 3], 'east')
      .place([2, 1, 0], 'create:andesite_belt_funnel', { facing: 'north', shape: 'pulling', powered: 'false' })
      .place([2, 1, 1], 'minecraft:barrel', chest)
    const speeds = { '0,0,0': -32, '1,0,0': -32, '2,0,0': -32, '3,0,0': -32 }
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:stone')], speeds)
    expect(rateOf(result, '2,1,0', 'minecraft:stone')).toBe(1)
    expect(sinkOf(result, '2,1,1', 'minecraft:stone')).toBe(1)
    // 取り込んだ物は、ベルトの端の先には行かない
    expect(at(result, '4,0,0')).toBeUndefined()
  })

  it('[TP-BLOCK-BELT-FUNNEL] ベルトのファンネル：進む向きの逆を向いていれば取り込む', () => {
    const fx = belt(blueprintFixture(), 0, 0, [0, 1, 2], 'east')
      .place([2, 1, 0], 'create:brass_belt_funnel', { facing: 'west', shape: 'extended', powered: 'false' })
      .place([3, 1, 0], 'minecraft:barrel', chest)
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:stone')], { '0,0,0': -8, '1,0,0': -8, '2,0,0': -8 })
    expect(sinkOf(result, '3,1,0', 'minecraft:stone')).toBe(1)
  })

  it('[TP-BLOCK-DEPOT] デポ：2段上のプレスで押し、1段上の pulling のベルトのファンネルで先へ', () => {
    const fx = blueprintFixture()
      .place([1, 0, 1], 'create:depot')
      .place([1, 1, 1], 'create:andesite_belt_funnel', { facing: 'north', shape: 'pulling', powered: 'false' })
      .place([1, 1, 2], 'minecraft:chest', chest)
      .place([1, 2, 1], 'create:mechanical_press', { facing: 'east' })
    const { result } = trace(fx, [port([1, 0, 1], 'minecraft:iron_ingot')], { '1,2,1': 256 })
    expect(at(result, '1,2,1')?.recipes[0]?.outputs[0]?.item).toBe('create:iron_sheet')
    expect(sinkOf(result, '1,1,2', 'create:iron_sheet')).toBe(1)
  })

  it('[TP-BLOCK-CHUTE] シュート：上から受け取って下へ。横からは受け取らない。斜めは pos.below().relative(facing の反対)。扇風機は仮定', () => {
    const fx = blueprintFixture()
      .place([1, 3, 0], 'create:chute', { facing: 'down' })
      .place([1, 2, 0], 'create:chute', { facing: 'east' })
      .place([0, 1, 0], 'minecraft:chest', chest)
      .place([1, 4, 0], 'create:encased_fan', { facing: 'down' })
    // 横から入れる：西へ進むベルト (3,2,0)→(2,2,0) の端の先がシュート (1,2,0) の東の面
    belt(fx, 2, 0, [3, 2], 'west')
    const { result, log } = trace(fx, [port([1, 3, 0], 'minecraft:stone'), port([3, 2, 0], 'minecraft:dirt')], { '3,2,0': 64, '2,2,0': 64 })
    expect(sinkOf(result, '0,1,0', 'minecraft:stone')).toBe(1)
    expect(at(result, '0,1,0')?.sinks[0]?.source).toBe('assumed')
    expect(messages(log)).toContain('シュートに扇風機がつながっているが、物は下へ流れるとした')
    expect(messages(log)).toContain('シュートは上からしか受け取らないので、物はここで止まる')
    expect(rateOf(result, '1,2,0', 'minecraft:dirt')).toBe(0)
  })

  it('[TP-BLOCK-CRUSHING][TP-RECIPE-TAGS] 粉砕ホイールの中心：タグのレシピで砕き、真下へ。横向きは扱わない', () => {
    const fx = blueprintFixture()
      .place([0, 1, 0], 'create:crushing_wheel', { axis: 'z' })
      .place([1, 1, 0], 'create:crushing_wheel_controller', { facing: 'down' })
      .place([2, 1, 0], 'create:crushing_wheel', { axis: 'z' })
      .place([1, 0, 0], 'minecraft:chest', chest)
      .place([1, 1, 2], 'create:crushing_wheel_controller', { facing: 'east' })
    const { result, log } = trace(
      fx,
      [port([1, 1, 0], 'minecraft:iron_ore', 2), port([1, 1, 2], 'minecraft:iron_ore')],
      { '0,1,0': 64, '2,1,0': -64 },
    )
    expect(at(result, '1,1,0')?.recipes[0]?.choice.recipe?.id).toBe('create:crushing/iron_ore')
    expect(sinkOf(result, '1,0,0', 'create:crushed_raw_iron')).toBe(2)
    expect(sinkOf(result, '1,0,0', 'create:experience_nugget')).toBe(1.5)
    expect(messages(log)).toContain('横向きの粉砕ホイール（ベルトの上の粉砕）は扱わないので、物はここで止まるとした')
  })

  it('[TP-BLOCK-SAW] ソー（上向き）：軸が Z なら回転数 > 0 で +X、軸が X なら回転数 > 0 で −Z へ', () => {
    const fx = blueprintFixture()
      .place([1, 0, 1], 'create:mechanical_saw', { facing: 'up', axis_along_first: 'false' })
      .place([2, 0, 1], 'minecraft:chest', chest)
      .place([0, 0, 1], 'minecraft:chest', chest)
      .place([1, 0, 4], 'create:mechanical_saw', { facing: 'up', axis_along_first: 'true' })
      .place([1, 0, 3], 'minecraft:chest', chest)
    const { result } = trace(
      fx,
      [port([1, 0, 1], 'minecraft:oak_log'), port([1, 0, 4], 'minecraft:oak_log')],
      { '1,0,1': 32, '1,0,4': 32 },
    )
    expect(sinkOf(result, '2,0,1', 'minecraft:stripped_oak_log')).toBe(1)
    expect(at(result, '0,0,1')).toBeUndefined()
    expect(sinkOf(result, '1,0,3', 'minecraft:stripped_oak_log')).toBe(1)
    const reverse = trace(fx, [port([1, 0, 1], 'minecraft:oak_log')], { '1,0,1': -32 }).result
    expect(sinkOf(reverse, '0,0,1', 'minecraft:stripped_oak_log')).toBe(1)
  })

  it('[TP-BLOCK-BASIN][TP-PATH-MULTI-INGREDIENT] ベイスン：ミキサーで混ぜて facing の先の下へ。ほかの材料は仮定。プレスなら圧縮、facing=down は取り出すファンネルへ', () => {
    const fx = blueprintFixture()
      .place([0, 1, 0], 'create:basin', { facing: 'east' })
      .place([0, 3, 0], 'create:mechanical_mixer')
      .place([1, 0, 0], 'create:depot')
      .place([3, 1, 0], 'create:basin', { facing: 'down' })
      .place([3, 3, 0], 'create:mechanical_press', { facing: 'north' })
      .place([4, 1, 0], 'create:andesite_funnel', { facing: 'east', extracting: 'true', powered: 'false' })
      .place([4, 0, 0], 'minecraft:chest', chest)
    const { result, log } = trace(
      fx,
      // ミキサーは 256 RPM で1分に 21 回なので、入る数はそれより少なくする
      [port([0, 1, 0], 'minecraft:andesite', 0.25), port([3, 1, 0], 'minecraft:flint')],
      { '0,3,0': 256, '3,3,0': 256 },
    )
    expect(sinkOf(result, '1,0,0', 'create:andesite_alloy')).toBe(0.25)
    expect(messages(log)).toContain('レシピ create:mixing/andesite_alloy のほかの材料は、あるものとした')
    expect(at(result, '3,1,0')?.recipes[0]?.type).toBe('compacting')
    expect(rateOf(result, '4,1,0', 'minecraft:granite')).toBe(1)
    expect(sinkOf(result, '4,0,0', 'minecraft:granite')).toBe(1)
  })

  it('[TP-BLOCK-FUNNEL-INSERT][TP-BLOCK-FUNNEL-EXTRACT] ファンネル：入れるファンネルは口の前からだけ受け取り、後ろの入れ物へ。水平の取り出すファンネルは真下に落とす（#253）', () => {
    const fx = blueprintFixture({ size: [4, 4, 3] })
      .place([1, 1, 0], 'minecraft:chest', chest)
      .place([1, 1, 1], 'create:brass_funnel', { facing: 'south', extracting: 'false', powered: 'false' })
      .place([2, 1, 0], 'create:andesite_funnel', { facing: 'east', extracting: 'true', powered: 'false' })
      .place([2, 0, 0], 'create:depot')
      .place([3, 1, 0], 'create:depot')
      .place([0, 3, 1], 'minecraft:chest', chest)
      .place([0, 3, 2], 'create:andesite_funnel', { facing: 'south', extracting: 'true', powered: 'false' })
    // 横から入れる：西へ進むベルト (3,1,1)→(2,1,1) の端の先が、入れるファンネル (1,1,1) の東の面
    belt(fx, 1, 1, [3, 2], 'west')
    const { result, log } = trace(fx, [port([1, 1, 1], 'minecraft:stone'), port([3, 1, 1], 'minecraft:dirt')], { '3,1,1': 64, '2,1,1': 64 })
    // ファンネル → 後ろの入れ物 (1,1,0) → 取り出すファンネル (2,1,0) → 真下のデポ。口の前のデポ (3,1,0) には出さない
    expect(rateOf(result, '1,1,0', 'minecraft:stone')).toBe(1)
    expect(sinkOf(result, '2,0,0', 'minecraft:stone')).toBe(1)
    expect(at(result, '3,1,0')).toBeUndefined()
    expect(messages(log)).toContain('ファンネルは口の前からしか受け取らないので、物はここで止まる')

    const fall = trace(fx, [port([0, 3, 1], 'minecraft:stone')])
    expect(messages(fall.log)).toContain('出す先（(0, 2, 2)）が空気で、3 段下までにブロックがないので、その先はたどらない')
  })

  it('[TP-BLOCK-ARM][TP-PATH-SPLIT] 機械アーム：TAKE の点から、すべての DEPOSIT の点へ等しく分ける', () => {
    const points = nbt.list('compound', [
      nbt.compound({ Pos: nbt.compound({ X: nbt.int(-1), Y: nbt.int(0), Z: nbt.int(0) }), Mode: nbt.string('TAKE') }),
      nbt.compound({ Pos: nbt.compound({ X: nbt.int(1), Y: nbt.int(0), Z: nbt.int(0) }), Mode: nbt.string('DEPOSIT') }),
      nbt.compound({ Pos: nbt.intArray([0, 0, 1]), Mode: nbt.string('DEPOSIT') }),
    ])
    const fx = blueprintFixture()
      .place([1, 0, 0], 'create:mechanical_arm', nbt.compound({ InteractionPoints: points }))
      .place([0, 0, 0], 'minecraft:chest', chest)
      .place([2, 0, 0], 'minecraft:chest', chest)
      .place([1, 0, 1], 'create:depot')
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:stone', 3)], { '1,0,0': 64 })
    expect(rateOf(result, '1,0,0', 'minecraft:stone')).toBe(3)
    expect(sinkOf(result, '2,0,0', 'minecraft:stone')).toBe(1.5)
    expect(sinkOf(result, '1,0,1', 'minecraft:stone')).toBe(1.5)

    // 止まっていれば運ばず、取る先に溜まる
    const stopped = trace(fx, [port([0, 0, 0], 'minecraft:stone', 3)], { '1,0,0': 0 }).result
    expect(sinkOf(stopped, '0,0,0', 'minecraft:stone')).toBe(3)
    expect(at(stopped, '1,0,0')?.notes).toContain('止まっているので、物を運ばない')
  })

  it('[TP-BLOCK-BELT-FUNNEL-PUSH] 押し出すベルトのファンネル：後ろの入れ物から取り出し、真下のデポに置く', () => {
    const build = (funnel: Record<string, string>) =>
      blueprintFixture()
        .place([1, 1, 0], 'minecraft:barrel', { facing: 'up' }, chest)
        .place([0, 1, 0], 'create:andesite_belt_funnel', { facing: 'west', powered: 'false', ...funnel })
        .place([0, 0, 0], 'create:depot')
    const { result } = trace(build({ shape: 'pushing' }), [port([1, 1, 0], 'minecraft:coal', 2)])
    expect(sinkOf(result, '1,1,0', 'minecraft:coal')).toBe(0)
    expect(rateOf(result, '0,1,0', 'minecraft:coal')).toBe(2)
    expect(sinkOf(result, '0,0,0', 'minecraft:coal')).toBe(2)

    // 信号が入っている、デポの上で取り込む形なら取り出さない
    for (const f of [{ shape: 'pushing', powered: 'true' }, { shape: 'pulling', powered: 'false' }]) {
      const r = trace(build(f), [port([1, 1, 0], 'minecraft:coal', 2)]).result
      expect(sinkOf(r, '1,1,0', 'minecraft:coal')).toBe(2)
      expect(rateOf(r, '0,0,0', 'minecraft:coal')).toBe(0)
    }
  })

  it('[TP-BLOCK-BELT-FUNNEL-PUSH] 平行の形のベルトのファンネルは、下のベルトが facing へ進むときだけ押し出す', () => {
    const fx = belt(blueprintFixture(), 0, 0, [2, 1, 0], 'west')
      .place([2, 1, 0], 'minecraft:barrel', { facing: 'up' }, chest)
      .place([1, 1, 0], 'create:andesite_belt_funnel', { facing: 'west', shape: 'retracted', powered: 'false' })
    const speeds = (rpm: number) => ({ '0,0,0': rpm, '1,0,0': rpm, '2,0,0': rpm })
    // X 軸のベルトは回転数 > 0 で西へ進む
    const west = trace(fx, [port([2, 1, 0], 'minecraft:coal', 1)], speeds(16)).result
    expect(rateOf(west, '1,0,0', 'minecraft:coal')).toBe(1)
    const east = trace(fx, [port([2, 1, 0], 'minecraft:coal', 1)], speeds(-16)).result
    expect(rateOf(east, '1,0,0', 'minecraft:coal')).toBe(0)
    expect(sinkOf(east, '2,1,0', 'minecraft:coal')).toBe(1)
  })

  it('[TP-BLOCK-DEPLOYER-HAND][TP-MOTION-DEPLOYER-HAND] デプロイヤーの手：2つ先のブレイズバーナーに燃料を入れる', () => {
    const points = nbt.list('compound', [
      nbt.compound({ Pos: nbt.compound({ X: nbt.int(-1), Y: nbt.int(0), Z: nbt.int(0) }), Mode: nbt.string('TAKE') }),
      nbt.compound({ Pos: nbt.compound({ X: nbt.int(0), Y: nbt.int(0), Z: nbt.int(1) }), Mode: nbt.string('DEPOSIT') }),
    ])
    const build = (mode: string, target: string) =>
      blueprintFixture()
        .place([1, 0, 0], 'create:mechanical_arm', nbt.compound({ InteractionPoints: points }))
        .place([0, 0, 0], 'create:depot')
        .place([1, 0, 1], 'create:deployer', { facing: 'up', axis_along_first: 'false' }, nbt.compound({ Mode: nbt.string(mode) }))
        .place([1, 2, 1], target, { blaze: 'smouldering', facing: 'east' })
    const speeds = (deployer: number) => ({ '1,0,0': 64, '1,0,1': deployer })
    const { result, log } = trace(build('USE', 'create:blaze_burner'), [port([0, 0, 0], 'minecraft:coal', 1)], speeds(16))
    expect(rateOf(result, '1,0,1', 'minecraft:coal')).toBe(1)
    expect(rateOf(result, '1,2,1', 'minecraft:coal')).toBe(1)
    expect(at(result, '1,0,1')?.capacityPerMinute).toBeGreaterThan(0)
    expect(messages(log).some((m) => m.includes('デプロイヤー'))).toBe(false)
    // 手に持って1回の動作のあいだ止まり、バーナーへ移る
    expect(result.moves.find((m) => m.from.join(',') === '0,0,0' && m.to.join(',') === '1,0,1')?.hold).toBeGreaterThan(0)
    expect(result.moves.some((m) => m.from.join(',') === '1,0,1' && m.to.join(',') === '1,2,1')).toBe(true)

    // 叩く設定、バーナーでない先、止まっているデプロイヤーでは、手で止まる
    const punch = trace(build('PUNCH', 'create:blaze_burner'), [port([0, 0, 0], 'minecraft:coal', 1)], speeds(16))
    expect(rateOf(punch.result, '1,2,1', 'minecraft:coal')).toBe(0)
    expect(messages(punch.log)).toContain('デプロイヤーが叩く設定なので、手の物の行き先は扱わず、物はここで止まるとした')
    const stone = trace(build('USE', 'minecraft:stone'), [port([0, 0, 0], 'minecraft:coal', 1)], speeds(16))
    expect(messages(stone.log)).toContain('デプロイヤーが手の物を使った結果は扱わないので、物はここで止まるとした')
    const stopped = trace(build('USE', 'create:blaze_burner'), [port([0, 0, 0], 'minecraft:coal', 1)], speeds(0)).result
    expect(rateOf(stopped, '1,2,1', 'minecraft:coal')).toBe(0)
    expect(at(stopped, '1,0,1')?.notes).toContain('止まっているので、物はここで止まる')
  })

  it('[TP-BLOCK-BLAZE-BURNER] ブレイズバーナー：届いた物は燃料として燃え、溜まらず、仮定にも載せない', () => {
    const points = nbt.list('compound', [
      nbt.compound({ Pos: nbt.compound({ X: nbt.int(-1), Y: nbt.int(0), Z: nbt.int(0) }), Mode: nbt.string('TAKE') }),
      nbt.compound({ Pos: nbt.compound({ X: nbt.int(1), Y: nbt.int(0), Z: nbt.int(0) }), Mode: nbt.string('DEPOSIT') }),
      nbt.compound({ Pos: nbt.compound({ X: nbt.int(0), Y: nbt.int(0), Z: nbt.int(1) }), Mode: nbt.string('DEPOSIT') }),
    ])
    const fx = blueprintFixture()
      .place([1, 0, 0], 'create:mechanical_arm', nbt.compound({ InteractionPoints: points }))
      .place([0, 0, 0], 'create:depot')
      .place([2, 0, 0], 'create:blaze_burner', { blaze: 'smouldering', facing: 'east' })
      .place([1, 0, 1], 'create:blaze_burner', { blaze: 'smouldering', facing: 'east' })
    const { result, log } = trace(fx, [port([0, 0, 0], 'minecraft:charcoal', 2)], { '1,0,0': 64 })
    expect(rateOf(result, '2,0,0', 'minecraft:charcoal')).toBe(1)
    expect(rateOf(result, '1,0,1', 'minecraft:charcoal')).toBe(1)
    expect(sinkOf(result, '2,0,0', 'minecraft:charcoal')).toBe(0)
    expect(at(result, '2,0,0')?.notes).toContain('燃料として燃やすので、物はここでなくなる')
    expect(messages(log).some((m) => m.includes('blaze_burner'))).toBe(false)
    expect(result.moves.filter((m) => m.to.join(',') === '2,0,0')).toHaveLength(1)
  })

  it('[TP-PATH-LOOP] 輪になった通り道は、同じ物が2回目に届いた所で止める', () => {
    const arm = (take: Vec3, deposit: Vec3) =>
      nbt.compound({
        InteractionPoints: nbt.list('compound', [
          nbt.compound({ Pos: nbt.intArray(take), Mode: nbt.string('TAKE') }),
          nbt.compound({ Pos: nbt.intArray(deposit), Mode: nbt.string('DEPOSIT') }),
        ]),
      })
    const fx = blueprintFixture()
      .place([0, 0, 0], 'minecraft:chest', chest)
      .place([2, 0, 0], 'minecraft:chest', chest)
      .place([1, 0, 0], 'create:mechanical_arm', arm([-1, 0, 0], [1, 0, 0]))
      .place([1, 1, 0], 'create:mechanical_arm', arm([1, -1, 0], [-1, -1, 0]))
    const { result, log } = trace(fx, [port([0, 0, 0], 'minecraft:stone')], { '1,0,0': 64, '1,1,0': 64 })
    expect(messages(log)).toContain('物の通り道が輪になっているので、同じ物が2回目に届いた所から先はたどらない')
    expect(rateOf(result, '2,0,0', 'minecraft:stone')).toBe(1)
  })

  it('[TP-PATH-OVERFLOW][TP-PATH-NO-RECIPE] 処理できる数を超えたら「処理が追いつかない」。レシピのない物はそこで止める', () => {
    const fx = blueprintFixture().place([0, 0, 0], 'create:millstone').place([2, 0, 0], 'create:millstone')
    // 16 RPM で小麦（処理時間 150）は 150 tick で1個 → 8 個/分。1 個/秒 = 60 個/分は多すぎる
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:wheat'), port([2, 0, 0], 'minecraft:stone')], {
      '0,0,0': 16,
      '2,0,0': 16,
    })
    expect(result.issues).toEqual([
      { pos: [0, 0, 0], message: '処理が追いつきません。届く数は 60 個/分、処理できるのは 8 個/分です。入る数を減らすか、回転数を上げてください。' },
    ])
    // できる物は、処理できる数（8 個/分）から計算する。小麦粉は 1 + 2 × 0.25 = 1.5 倍
    expect(sinkOf(result, '0,0,0', 'create:wheat_flour')).toBeCloseTo((8 / 60) * 1.5)
    expect(at(result, '2,0,0')?.noRecipe).toEqual(['minecraft:stone'])
    expect(itemPathValues(at(result, '2,0,0')!).find((v) => v.label === 'レシピ')?.value.value).toBe('Modpack にこの物のレシピがない（minecraft:stone）')
  })

  it('[TP-RECIPE-NO-PACK] Modpack のレシピがなければ、レシピがないのではなく分からないと出す', () => {
    const fx = blueprintFixture().place([0, 0, 0], 'create:millstone')
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:wheat')], { '0,0,0': 16 }, null)
    expect(at(result, '0,0,0')?.recipesUnknown).toBe(true)
    expect(itemPathValues(at(result, '0,0,0')!).find((v) => v.label === 'レシピ')?.value.value).toBe(
      'Modpack を読んでいないので、レシピが分からない（minecraft:wheat）。上のバーで Modpack を選ぶと、できる物をたどる',
    )
  })

  it('[TP-PATH-INPUT] アイテムを選んでいない物の入口は、仮定に載せてたどらない。Modpack がなければ機械で止まる', () => {
    const fx = blueprintFixture().place([0, 0, 0], 'create:millstone')
    const { result, log } = trace(fx, [port([0, 0, 0], null)], { '0,0,0': 16 })
    expect(result.records).toEqual([])
    expect(messages(log)).toEqual(['物の入口のアイテムが選ばれていない'])
    const none = trace(fx, [port([0, 0, 0], 'minecraft:wheat')], { '0,0,0': 16 }, null)
    expect(messages(none.log)).toContain('Modpack のレシピがないので、機械でできる物が分からず、物の通り道は機械で止まる')
  })
})

describe('律速（docs/create-throughput.md「律速（#168）」の例）', () => {
  /** 小麦 → 石臼 → シュート → ベルト → デポに溜まる */
  const line = (millRpm: number) => {
    const fx = blueprintFixture()
      .place([1, 3, 0], 'create:millstone')
      .place([1, 2, 0], 'create:chute', { facing: 'down' })
      .place([3, 1, 0], 'create:depot')
    belt(fx, 1, 0, [1, 2], 'east')
    return trace(fx, [port([1, 3, 0], 'minecraft:wheat', 1)], { '1,3,0': millRpm, '1,1,0': -32, '2,1,0': -32 }).result
  }

  it('[TP-BOTTLENECK-USAGE][TP-BOTTLENECK-IO][TP-BOTTLENECK-HEADROOM][TP-BOTTLENECK-OUTPUT] 256 RPM：石臼は 120 個/分。使用率 50%、出る数 105 個/分、入る数は 120 個/分まで増やせる', () => {
    const result = line(256)
    expect(result.line).toEqual({
      inputPerMinute: 60,
      outputPerMinute: 105,
      bottleneck: { pos: [1, 3, 0], machine: '石臼', arrivingPerMinute: 60, capacityPerMinute: 120, utilization: 0.5 },
      outputsUnknown: false,
      source: 'virtual',
    })
    expect(lineSummary(result.line!)).toEqual({
      label: '生産ライン',
      value: {
        value: '入る 60 個/分 → 律速 石臼 120 個/分のうち 60 個/分（50%） → 出る 105 個/分。入る数は 120 個/分まで増やせる',
        source: 'virtual',
      },
      pos: [1, 3, 0],
    })
    expect(bottleneckValue(result.line!)?.value.value).toBe('生産ラインで一番忙しい機械。使用率 50%')
  })

  it('[TP-BOTTLENECK-OVER] 16 RPM：石臼は 8 個/分。使用率 750% で追いつかず、出る数は 14 個/分。増やせる数は出さない', () => {
    const result = line(16)
    expect(result.line?.bottleneck?.utilization).toBe(7.5)
    expect(result.line?.outputPerMinute).toBeCloseTo(14)
    expect(lineSummary(result.line!).value.value).toBe('入る 60 個/分 → 律速 石臼 8 個/分のうち 60 個/分（750%、追いつかない） → 出る 14 個/分')
    expect(bottleneckValue(result.line!)?.value.value).toBe('生産ラインで一番忙しい機械。使用率 750%（追いつかない）')
  })

  it('[TP-BOTTLENECK-CHOOSE] 使用率が一番高い機械を律速にする。同じなら先にたどった方', () => {
    // 2つの石臼に別々の入口。256 RPM（120 個/分）に 60 個/分、64 RPM（⌈150 / 4⌉ = 38 tick、32 個/分）に 30 個/分
    const fx = blueprintFixture().place([0, 0, 0], 'create:millstone').place([2, 0, 0], 'create:millstone')
    const busy = trace(fx, [port([0, 0, 0], 'minecraft:wheat', 1), port([2, 0, 0], 'minecraft:wheat', 0.5)], {
      '0,0,0': 256,
      '2,0,0': 64,
    }).result
    expect(busy.line?.inputPerMinute).toBe(90)
    expect(busy.line?.bottleneck?.pos).toEqual([2, 0, 0])
    const tie = trace(fx, [port([2, 0, 0], 'minecraft:wheat', 1), port([0, 0, 0], 'minecraft:wheat', 1)], {
      '0,0,0': 256,
      '2,0,0': 256,
    }).result
    expect(tie.line?.bottleneck?.pos).toEqual([2, 0, 0])
  })

  it('[TP-BOTTLENECK-NONE] 処理する機械がなければ、律速を出さずに入る数と出る数だけ。入口がなければ null', () => {
    const fx = blueprintFixture().place([0, 0, 0], 'create:depot')
    const result = trace(fx, [port([0, 0, 0], 'minecraft:wheat', 1)]).result
    expect(result.line?.bottleneck).toBeNull()
    expect(lineSummary(result.line!).value.value).toBe('入る 60 個/分 → 出る 60 個/分。処理する機械がない')
    expect(lineSummary(result.line!).pos).toBeUndefined()
    expect(trace(fx, []).result.line).toBeNull()
  })

  it('[TP-BOTTLENECK-NO-PACK] Modpack がなければ、処理時間は Create の初期値（石臼 100）で律速を出し、出どころは仮定', () => {
    // 256 RPM：⌈100 / 16⌉ = 7 tick で1個、171 個/分
    const fx = blueprintFixture().place([0, 0, 0], 'create:millstone')
    const { result, log } = trace(fx, [port([0, 0, 0], 'minecraft:wheat', 1)], { '0,0,0': 256 }, null)
    expect(result.line?.bottleneck).toMatchObject({ machine: '石臼', arrivingPerMinute: 60 })
    expect(result.line?.bottleneck?.capacityPerMinute).toBeCloseTo(1200 / 7)
    expect(result.line?.source).toBe('assumed')
    expect(result.line?.outputPerMinute).toBe(0)
    expect(lineSummary(result.line!).value.value).toBe(
      '入る 60 個/分 → 律速 石臼 171 個/分のうち 60 個/分（35%） → 出る 0 個/分（Modpack がないので、機械でできる物は数えていない）。入る数は 171 個/分まで増やせる',
    )
    expect(messages(log)).toContain('石臼のレシピが分からないので、処理時間を Create の初期値の 100 tick とした')
  })
})

describe('物の通り道（runCreateStress）', () => {
  const pack: CalcModpack = { hasNamespace: (ns) => ns === 'create', config: async () => null, recipeBook: async () => BOOK }
  const bone = nbt.compound({
    InputInventory: nbt.compound({ Items: nbt.list('compound', [nbt.compound({ id: nbt.string('minecraft:bone'), Count: nbt.byte(1) })]) }),
  })
  const bp = () =>
    blueprintFixture()
      .place([0, 0, 0], 'create:creative_motor', { facing: 'up' }, nbt.compound({ ScrollValue: nbt.int(64) }))
      .place([0, 1, 0], 'create:millstone', bone)
      .place([2, 0, 0], 'minecraft:chest', chest)
      .toBlueprint()
  const value = (r: Awaited<ReturnType<typeof runCreateStress>>, pos: string, label: string) =>
    r.probes?.find((p) => p.pos.join() === pos)?.values.find((v) => v.label === label)?.value

  it('[TP-PATH-PROBE] 届く物・レシピ・溜まる物をプローブに出し、処理時間は通り道のレシピで計算する', async () => {
    const result = await runCreateStress(bp(), { pack, ports: [port([0, 1, 0], 'minecraft:wheat', 0.5)] })
    expect(value(result, '0,1,0', '届く物')).toEqual({ value: 'minecraft:wheat 0.5 個/秒（物の入口から）', source: 'virtual' })
    expect(value(result, '0,1,0', 'レシピ')?.value).toContain('create:milling/wheat（minecraft:wheat → create:wheat_flour 0.75 個/秒')
    // 生データの骨ではなく、届く小麦のレシピ（処理時間 150）で計算する
    expect(value(result, '0,1,0', '処理時間')).toEqual({ value: '38 tick（1.9 秒）で1個。32 個/分', source: 'modpack' })
    expect(value(result, '0,1,0', '溜まる物')?.value).toBe('create:wheat_flour 0.75 個/秒、minecraft:wheat_seeds 0.13 個/秒')
    expect(result.probes?.filter((p) => p.pos.join() === '0,1,0')).toHaveLength(1)
    expect(result.issues).toEqual([])
    // 生産ラインの行はまとめの次。律速の機械のプローブに「律速」
    expect(result.summary[1]).toMatchObject({ label: '生産ライン', pos: [0, 1, 0] })
    expect(value(result, '0,1,0', '律速')?.value).toBe('生産ラインで一番忙しい機械。使用率 95%')
    expect(structuredClone(result)).toEqual(result)
  })

  it('[TP-PATH-OVERFLOW][TP-PATH-INPUT] 処理が追いつかないと計算の問題に出す。アイテムのない入口は仮定に載せる', async () => {
    const result = await runCreateStress(bp(), {
      pack,
      ports: [port([0, 1, 0], 'minecraft:wheat', 1), port([2, 0, 0], null)],
    })
    expect(result.issues.map((i) => i.message)).toContain(
      '処理が追いつきません。届く数は 60 個/分、処理できるのは 32 個/分です。入る数を減らすか、回転数を上げてください。',
    )
    expect(result.assumptions).toContainEqual({ pos: [2, 0, 0], message: '物の入口のアイテムが選ばれていない' })
  })
})

describe('物の通り道・物の動きの規則ごとの確かめ（#237）', () => {
  const moveOf = (r: ItemPathResult, from: string, to: string, item?: string) =>
    r.moves.find((m) => m.from.join(',') === from && m.to.join(',') === to && (item === undefined || m.item === item))

  it('[TP-MOTION-FUNNEL-INSERT][TP-MOTION-INSTANT] 物の動き：入れるファンネルは、口の前の物を後ろの入れ物へ時間 0 で入れる', () => {
    const fx = belt(blueprintFixture(), 0, 0, [0, 1, 2], 'east')
      .place([3, 0, 0], 'create:andesite_funnel', { facing: 'west', extracting: 'false', powered: 'false' })
      .place([4, 0, 0], 'minecraft:chest', chest)
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:stone')], { '0,0,0': -48, '1,0,0': -48, '2,0,0': -48 })
    expect(moveOf(result, '2,0,0', '3,0,0')?.seconds).toBe(0.5)
    expect(moveOf(result, '3,0,0', '4,0,0')).toMatchObject({ seconds: 0, hold: 0 })
    expect(sinkOf(result, '4,0,0', 'minecraft:stone')).toBe(1)
  })

  it('[TP-MOTION-BELT-FUNNEL] 物の動き：ベルトのファンネルは、下の区間から後ろの入れ物へ時間 0 で取り込み、ベルトの先へは進まない', () => {
    const fx = belt(blueprintFixture(), 0, 0, [0, 1, 2], 'east')
      .place([1, 1, 0], 'create:andesite_belt_funnel', { facing: 'north', shape: 'pulling', powered: 'false' })
      .place([1, 1, 1], 'minecraft:chest', chest)
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:stone')], { '0,0,0': -48, '1,0,0': -48, '2,0,0': -48 })
    expect(moveOf(result, '0,0,0', '1,0,0')?.seconds).toBe(0.5)
    expect(moveOf(result, '1,0,0', '1,1,0')?.seconds).toBe(0)
    expect(moveOf(result, '1,1,0', '1,1,1')?.seconds).toBe(0)
    expect(moveOf(result, '1,0,0', '2,0,0')).toBeUndefined()
    expect(sinkOf(result, '1,1,1', 'minecraft:stone')).toBe(1)
  })

  it('[TP-MOTION-DEPOT][TP-MOTION-WAIT] 物の動き：デポは上のプレスの1回分止まる。届く数が処理できる数を超えても、待つのは1回分', () => {
    const fx = blueprintFixture().place([0, 0, 0], 'create:depot').place([0, 2, 0], 'create:mechanical_press', { facing: 'north' })
    for (const rate of [0.1, 100]) {
      const { result } = trace(fx, [port([0, 0, 0], 'minecraft:iron_ingot', rate)], { '0,2,0': 64 })
      expect(moveOf(result, '0,0,0', '0,0,0', 'minecraft:iron_ingot')).toMatchObject({ seconds: 0, hold: pressCycleTicks(64)! / 20 })
    }
  })

  it('[TP-MOTION-WAIT] 物の動き：石臼で待つ時間は、届く数が多くても処理1回分', () => {
    const fx = blueprintFixture().place([0, 0, 0], 'create:millstone')
    const slow = trace(fx, [port([0, 0, 0], 'minecraft:wheat', 0.1)], { '0,0,0': 256 }).result
    const fast = trace(fx, [port([0, 0, 0], 'minecraft:wheat', 100)], { '0,0,0': 256 }).result
    const hold = millstoneTicks(256, 150)! / 20
    expect(moveOf(slow, '0,0,0', '0,0,0')?.hold).toBe(hold)
    expect(moveOf(fast, '0,0,0', '0,0,0')?.hold).toBe(hold)
  })

  it('[TP-MOTION-CRUSHING] 物の動き：粉砕ホイールは真ん中で処理1回分待ち、できた物を真下へ落とす', () => {
    const fx = blueprintFixture()
      .place([0, 1, 0], 'create:crushing_wheel', { axis: 'z' })
      .place([1, 1, 0], 'create:crushing_wheel_controller', { facing: 'down' })
      .place([2, 1, 0], 'create:crushing_wheel', { axis: 'z' })
      .place([1, 0, 0], 'minecraft:chest', chest)
    const { result } = trace(fx, [port([1, 1, 0], 'minecraft:iron_ore')], { '0,1,0': 64, '2,1,0': -64 })
    expect(moveOf(result, '1,1,0', '1,1,0')?.hold).toBe(machineCycleTicks('crushing_wheel', 64, 250)! / 20)
    const fall = moveOf(result, '1,1,0', '1,0,0', 'create:crushed_raw_iron')!
    const expected = throwPath(blockCenter([1, 1, 0]), blockCenter([1, 0, 0]), 0)
    expect(fall.seconds).toBe(expected.seconds)
    expect(fall.path![0]!.pos).toEqual([1.5, 1.5, 0.5])
    expect(fall.path![fall.path!.length - 1]!.pos).toEqual([1.5, 0.5, 0.5])
  })

  it('[TP-MOTION-SAW] 物の動き：ソーは上で処理1回分待ち、できた物を上から回転の向きへ、上向き 1/8 ブロック/tick で放り出す', () => {
    const fx = blueprintFixture()
      .place([1, 0, 1], 'create:mechanical_saw', { facing: 'up', axis_along_first: 'false' })
      .place([2, 0, 1], 'minecraft:chest', chest)
    const { result } = trace(fx, [port([1, 0, 1], 'minecraft:oak_log')], { '1,0,1': 32 })
    expect(moveOf(result, '1,0,1', '1,0,1')?.hold).toBe(machineCycleTicks('mechanical_saw', 32, 50)! / 20)
    const thrown = moveOf(result, '1,0,1', '2,0,1', 'minecraft:stripped_oak_log')!
    const expected = throwPath([1.5, 1, 1.5], blockCenter([2, 0, 1]), 1 / 8)
    expect(thrown.seconds).toBe(expected.seconds)
    expect(thrown.path![0]!.pos).toEqual([1.5, 1, 1.5])
    // 上向きに投げるので、はじめは上がる
    expect(thrown.path![1]!.pos[1]).toBeGreaterThan(1)
  })

  it('[TP-MOTION-BASIN] 物の動き：ベイスンは上のミキサーの処理1回分待ち、出す向きの下へ時間 0 で移す', () => {
    const fx = blueprintFixture()
      .place([0, 1, 0], 'create:basin', { facing: 'east' })
      .place([0, 3, 0], 'create:mechanical_mixer')
      .place([1, 0, 0], 'create:depot')
    const { result } = trace(fx, [port([0, 1, 0], 'minecraft:andesite', 0.1)], { '0,3,0': 256 })
    expect(moveOf(result, '0,1,0', '0,1,0')?.hold).toBe(machineCycleTicks('mechanical_mixer', 256, 0)! / 20)
    expect(moveOf(result, '0,1,0', '1,0,0', 'create:andesite_alloy')?.seconds).toBe(0)
  })

  it('[TP-MOTION-INVENTORY] 物の動き：入れ物の中は描かない。入った物は、取り出すファンネルの所から出る', () => {
    const fx = blueprintFixture({ size: [4, 3, 3] })
      .place([1, 1, 0], 'minecraft:chest', chest)
      .place([2, 1, 0], 'create:andesite_funnel', { facing: 'east', extracting: 'true', powered: 'false' })
      .place([2, 0, 0], 'create:depot')
    const { result } = trace(fx, [port([1, 1, 0], 'minecraft:stone')])
    expect(result.moves.filter((m) => m.to.join(',') === '1,1,0')).toEqual([])
    expect(moveOf(result, '1,1,0', '2,1,0')).toMatchObject({ seconds: 0, hold: 0 })
    expect(moveOf(result, '2,1,0', '2,0,0')).toBeDefined()
  })

  it('[TP-MOTION-STOPPED] 物の動き：回転数が 0 のベルト・石臼は動かさない', () => {
    const fx = belt(blueprintFixture().place([3, 0, 0], 'minecraft:chest', chest), 0, 0, [0, 1, 2], 'east').place([0, 0, 2], 'create:millstone')
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:stone'), port([0, 0, 2], 'minecraft:wheat')], {})
    expect(result.moves).toEqual([])
  })

  it('[TP-PATH-MERGE] 同じ物が2つの結果に出るレシピは、1つの流れにまとめる（小麦粉 1 + 2 × 25%）', () => {
    const fx = blueprintFixture().place([0, 0, 0], 'create:millstone')
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:wheat')], { '0,0,0': 256 })
    const sinks = at(result, '0,0,0')!.sinks
    expect(sinks.filter((s) => s.item === 'create:wheat_flour')).toHaveLength(1)
    expect(sinkOf(result, '0,0,0', 'create:wheat_flour')).toBe(1.5)
    expect(at(result, '0,0,0')!.recipes[0]!.outputs.map((o) => o.item)).toEqual(['create:wheat_flour', 'minecraft:wheat_seeds'])
  })

  it('[TP-PATH-BATCH] 粉砕ホイールとソーの処理できる数は、64 個まとめて入れたときの値', () => {
    const fx = blueprintFixture()
      .place([0, 1, 0], 'create:crushing_wheel', { axis: 'z' })
      .place([1, 1, 0], 'create:crushing_wheel_controller', { facing: 'down' })
      .place([2, 1, 0], 'create:crushing_wheel', { axis: 'z' })
      .place([1, 0, 0], 'minecraft:chest', chest)
      .place([1, 0, 3], 'create:mechanical_saw', { facing: 'up', axis_along_first: 'false' })
      .place([2, 0, 3], 'minecraft:chest', chest)
    const { result } = trace(fx, [port([1, 1, 0], 'minecraft:iron_ore'), port([1, 0, 3], 'minecraft:oak_log')], {
      '0,1,0': 64,
      '2,1,0': -64,
      '1,0,3': 64,
    })
    expect(at(result, '1,1,0')?.capacityPerMinute).toBe((1200 / crushingTicks(64, 250, 64)!) * 64)
    expect(at(result, '1,0,3')?.capacityPerMinute).toBe((1200 / sawTicks(64, 50, 64)!) * 64)
    // 1個ずつ入れるより多い
    expect(at(result, '1,1,0')!.capacityPerMinute!).toBeGreaterThan(1200 / crushingTicks(64, 250, 1)!)
  })

  it('[TP-BLOCK-INVENTORY] ほかのブロックは入れ物とみなす。ブロックエンティティがなければ仮定に載せる', () => {
    const fx = belt(blueprintFixture(), 0, 0, [0, 1], 'east')
      .place([2, 0, 0], 'minecraft:barrel')
      .place([0, 0, 2], 'create:item_vault', nbt.compound({}))
    const { result, log } = trace(fx, [port([0, 0, 0], 'minecraft:stone'), port([0, 0, 2], 'minecraft:dirt')], {
      '0,0,0': -48,
      '1,0,0': -48,
    })
    expect(sinkOf(result, '2,0,0', 'minecraft:stone')).toBe(1)
    expect(sinkOf(result, '0,0,2', 'minecraft:dirt')).toBe(1)
    expect(messages(log)).toContain('minecraft:barrel を物の入れ物とみなした')
    expect(messages(log)).not.toContain('create:item_vault を物の入れ物とみなした')
  })

  it('[TP-BLOCK-UNKNOWN][TP-FAN] 表にない Create のブロック（扇風機・鳩時計）は、そこで止めて仮定に載せる（#235）', () => {
    const fx = blueprintFixture()
      .place([0, 0, 0], 'create:encased_fan', { facing: 'up' })
      .place([2, 0, 0], 'create:cuckoo_clock', { facing: 'north' })
    const { result, log } = trace(fx, [port([0, 0, 0], 'minecraft:stone'), port([2, 0, 0], 'minecraft:stone')], {
      '0,0,0': 64,
      '2,0,0': 64,
    })
    for (const [pos, id] of [
      ['0,0,0', 'create:encased_fan'],
      ['2,0,0', 'create:cuckoo_clock'],
    ] as const) {
      expect(rateOf(result, pos, 'minecraft:stone')).toBe(1)
      expect(at(result, pos)?.sinks).toEqual([])
      expect(messages(log)).toContain(`${id} に届いた物の行き先は扱わないので、物はここで止まるとした`)
    }
  })

  it('[TP-BOTTLENECK-MACHINES] 律速に入れるのはレシピで処理した機械だけ。デプロイヤー・ベルトは忙しくても入れない', () => {
    const fx = belt(blueprintFixture(), 0, 0, [0, 1, 2], 'east')
      .place([1, 2, 0], 'create:deployer', { facing: 'down' })
      .place([3, 0, 0], 'create:millstone')
    // デプロイヤーは 64 RPM で 60 個/分。2 個/秒（120 個/分）では追いつかないが、律速は石臼
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:wheat', 2)], {
      '0,0,0': -48,
      '1,0,0': -48,
      '2,0,0': -48,
      '1,2,0': 64,
      '3,0,0': 256,
    })
    expect(at(result, '1,2,0')?.capacityPerMinute).toBe(60)
    expect(result.line?.bottleneck?.pos).toEqual([3, 0, 0])
    expect(result.line?.bottleneck?.machine).toBe('石臼')
  })

  it('[TP-BOTTLENECK-OUTPUT] まとめの「生産ライン」の行は、押すと律速の機械へ移る（pos）。律速がなければ pos を持たない', () => {
    const fx = blueprintFixture().place([0, 0, 0], 'create:millstone').place([2, 0, 0], 'minecraft:chest', chest)
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:wheat')], { '0,0,0': 256 })
    expect(lineSummary(result.line!).pos).toEqual([0, 0, 0])
    expect(bottleneckValue(result.line!)?.label).toBe('律速')
    const none = trace(fx, [port([2, 0, 0], 'minecraft:wheat')]).result
    expect(lineSummary(none.line!).pos).toBeUndefined()
    expect(bottleneckValue(none.line!)).toBeNull()
  })
})

describe('物の通り道の分かれ道（#237）', () => {
  const speeds3 = (rpm: number) => ({ '0,0,0': rpm, '1,0,0': rpm, '2,0,0': rpm })

  it('[TP-PATH-INPUT] 物の入口でない仮の入出力と、入る数が 0 の入口は飛ばす。先にブロックのない入口は仮定に載せる', () => {
    const fx = blueprintFixture().place([0, 0, 0], 'minecraft:chest', chest)
    const source: VirtualPort = { ...port([0, 0, 0], 'minecraft:stone'), kind: 'rotation-source' }
    const { result, log } = trace(fx, [source, port([0, 0, 0], 'minecraft:stone', 0), port([1, 0, 0], 'minecraft:stone')])
    expect(result.records).toEqual([])
    expect(result.line).toBeNull()
    expect(messages(log)).toEqual(['物の入口の先にブロックがないので、物の通り道をたどらない'])
  })

  it('[TP-BLOCK-BELT] 縦のベルトは扱わず、そこで止めて仮定に載せる', () => {
    const fx = blueprintFixture().place([0, 0, 0], 'create:belt', { facing: 'east', slope: 'vertical', part: 'start' })
    const { result, log } = trace(fx, [port([0, 0, 0], 'minecraft:stone')], { '0,0,0': 32 })
    expect(rateOf(result, '0,0,0', 'minecraft:stone')).toBe(1)
    expect(messages(log)).toContain('縦・横向きのベルトは扱わないので、物はここで止まるとした')
  })

  it('[TP-BLOCK-BELT-FUNNEL] 進む向きを向いたベルトのファンネル・信号の入ったベルトのファンネルは取り込まない', () => {
    for (const funnel of [
      { facing: 'east', shape: 'retracted', powered: 'false' },
      { facing: 'west', shape: 'pushing', powered: 'false' },
      { facing: 'west', shape: 'pulling', powered: 'true' },
    ]) {
      const fx = belt(blueprintFixture(), 0, 0, [0, 1, 2], 'east')
        .place([1, 1, 0], 'create:brass_belt_funnel', funnel)
        .place([3, 0, 0], 'minecraft:chest', chest)
      const { result } = trace(fx, [port([0, 0, 0], 'minecraft:stone')], speeds3(-48))
      expect(sinkOf(result, '3,0,0', 'minecraft:stone')).toBe(1)
    }
  })

  it('[TP-ANDESITE-TUNNEL] 横に口のない安山岩のトンネルは、仮定に載せずに素通りする', () => {
    const fx = belt(blueprintFixture(), 0, 1, [0, 1, 2], 'east')
      .place([1, 1, 1], 'create:andesite_tunnel')
      .place([3, 0, 1], 'minecraft:chest', chest)
    const { result, log } = trace(fx, [port([0, 0, 1], 'minecraft:stone')], { '0,0,1': -48, '1,0,1': -48, '2,0,1': -48 })
    expect(sinkOf(result, '3,0,1', 'minecraft:stone')).toBe(1)
    expect(rateOf(result, '1,1,1', 'minecraft:stone')).toBe(1)
    expect(messages(log)).toEqual([])
  })

  it('[TP-EJECTOR] 向きが分からないイジェクターは、そこで止めて仮定に載せる', () => {
    const fx = blueprintFixture().place([0, 0, 0], 'create:weighted_ejector', { facing: 'up' })
    const { log } = trace(fx, [port([0, 0, 0], 'minecraft:stone')], { '0,0,0': 64 })
    expect(messages(log)).toContain('イジェクターの向きが分からないので、物はここで止まる')
  })

  it('[TP-ITEM-DRAIN] 上や入れ物として入れた物は、ドレインの中に置かれる（先がなければ溜まる）', () => {
    const fx = blueprintFixture().place([0, 0, 0], 'create:item_drain')
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:stone')])
    expect(sinkOf(result, '0,0,0', 'minecraft:stone')).toBe(1)
  })

  it('[TP-HOPPER] 2.5 個/秒までなら注記を出さない。先が空気なら、ただの入れ物', () => {
    const fx = blueprintFixture().place([0, 1, 0], 'minecraft:hopper', { facing: 'down', enabled: 'true' })
    const { result } = trace(fx, [port([0, 1, 0], 'minecraft:stone', 2)])
    expect(at(result, '0,1,0')?.notes).toEqual([])
    expect(sinkOf(result, '0,1,0', 'minecraft:stone')).toBe(2)
  })

  it('[TP-BLOCK-BELT-MACHINE][TP-PATH-STOPPED] 止まっているベルトの上のプレスは処理せず、物はそのまま進む', () => {
    const fx = belt(blueprintFixture().place([1, 2, 0], 'create:mechanical_press', { facing: 'north' }), 0, 0, [0, 1, 2], 'east').place(
      [3, 0, 0],
      'minecraft:chest',
      chest,
    )
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:iron_ingot')], { ...speeds3(-24), '1,2,0': 0 })
    expect(at(result, '1,2,0')?.notes).toContain('止まっているので、下を通る物を処理しない')
    expect(sinkOf(result, '3,0,0', 'minecraft:iron_ingot')).toBe(1)
  })

  it('[TP-BLOCK-DEPOT][TP-PATH-NO-RECIPE] デポの上のプレスにレシピのない物が届いたら、そこで止まる', () => {
    const fx = blueprintFixture().place([0, 0, 0], 'create:depot').place([0, 2, 0], 'create:mechanical_press', { facing: 'north' })
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:stone')], { '0,2,0': 64 })
    expect(at(result, '0,2,0')?.noRecipe).toEqual(['minecraft:stone'])
    expect(at(result, '0,0,0')?.sinks).toEqual([])
  })

  it('[TP-BLOCK-CRUSHING] 横から届いた物は受け取らない。粉砕ホイールがなければ止まっているとする', () => {
    const fx = belt(blueprintFixture(), 0, 0, [0, 1], 'east')
      .place([2, 0, 0], 'create:crushing_wheel_controller', { facing: 'down' })
      .place([2, 0, 2], 'create:crushing_wheel_controller', { facing: 'down' })
    const { result, log } = trace(fx, [port([0, 0, 0], 'minecraft:iron_ore'), port([2, 0, 2], 'minecraft:iron_ore')], {
      '0,0,0': -48,
      '1,0,0': -48,
    })
    expect(messages(log)).toContain('粉砕ホイールは上からしか受け取らないので、物はここで止まる')
    expect(at(result, '2,0,0')).toBeUndefined()
    expect(at(result, '2,0,2')?.notes).toContain('粉砕ホイールが止まっているので、物はここで止まる')
  })

  it('[TP-BLOCK-SAW] 上向きでないソーは仮定に載せて止める。止まったソーでも止まる。軸が X で回転数 < 0 なら +Z へ', () => {
    const fx = blueprintFixture()
      .place([0, 0, 0], 'create:mechanical_saw', { facing: 'north', axis_along_first: 'false' })
      .place([2, 0, 0], 'create:mechanical_saw', { facing: 'up', axis_along_first: 'false' })
      .place([4, 0, 1], 'create:mechanical_saw', { facing: 'up', axis_along_first: 'true' })
      .place([4, 0, 2], 'minecraft:chest', chest)
    const { result, log } = trace(
      fx,
      [port([0, 0, 0], 'minecraft:oak_log'), port([2, 0, 0], 'minecraft:oak_log'), port([4, 0, 1], 'minecraft:oak_log')],
      { '0,0,0': 32, '4,0,1': -32 },
    )
    expect(messages(log)).toContain('上向きでないソーは扱わないので、物はここで止まるとした')
    expect(at(result, '2,0,0')?.notes).toContain('止まっているので、物はここで止まる')
    expect(sinkOf(result, '4,0,2', 'minecraft:stripped_oak_log')).toBe(1)
  })

  it('[TP-BLOCK-BASIN] 上に機械のないベイスンは入れ物。止まった機械なら止まる。出す先が空気なら溜まる（仮定）', () => {
    const fx = blueprintFixture()
      .place([0, 0, 0], 'create:basin', { facing: 'down' })
      .place([2, 0, 0], 'create:basin', { facing: 'down' })
      .place([2, 2, 0], 'create:mechanical_mixer')
      .place([4, 1, 0], 'create:basin', { facing: 'east' })
      .place([4, 3, 0], 'create:mechanical_press', { facing: 'north' })
    const { result, log } = trace(
      fx,
      [port([0, 0, 0], 'minecraft:stone'), port([2, 0, 0], 'minecraft:andesite', 0.1), port([4, 1, 0], 'minecraft:flint', 0.1)],
      { '4,3,0': 256 },
    )
    expect(sinkOf(result, '0,0,0', 'minecraft:stone')).toBe(1)
    expect(at(result, '2,0,0')?.notes).toContain('上の機械が止まっているので、物はここで止まる')
    expect(at(result, '4,1,0')?.sinks).toEqual([{ item: 'minecraft:granite', rate: 0.1, source: 'assumed' }])
    expect(messages(log)).toContain('ベイスンの出す先に入れ物がないので、できた物はベイスンに溜まるとした')
  })

  it('[TP-BLOCK-FUNNEL-INSERT] 向きのない・取り出す・信号の入った・後ろに入れ物のないファンネルでは止まる', () => {
    const fx = blueprintFixture({ size: [8, 2, 3] })
      .place([0, 0, 0], 'create:andesite_funnel', { extracting: 'false', powered: 'false' })
      .place([2, 0, 0], 'create:andesite_funnel', { facing: 'north', extracting: 'true', powered: 'false' })
      .place([4, 0, 0], 'create:andesite_funnel', { facing: 'north', extracting: 'false', powered: 'true' })
      .place([6, 0, 0], 'create:andesite_funnel', { facing: 'north', extracting: 'false', powered: 'false' })
    const { result, log } = trace(fx, [0, 2, 4, 6].map((x) => port([x, 0, 0], 'minecraft:stone')))
    // 受け取らないファンネルは、届く物にも数えず、仮定に載せる
    expect(log.list()).toEqual([
      { pos: [0, 0, 0], message: 'ファンネルの向きが分からないので、物はここで止まる' },
      { pos: [2, 0, 0], message: '取り出すファンネルは物を受け取らないので、物はここで止まる' },
      { pos: [4, 0, 0], message: 'ファンネルにレッドストーンの信号が入っていて動かないので、物はここで止まる' },
    ])
    expect(at(result, '6,0,0')?.notes).toEqual(['ファンネルの後ろに入れ物がないので、物はここで止まる'])
  })

  it('[TP-PATH-OVERFLOW] 同じ機械に2つの入口から届くと、処理できた分だけをまとめて出し、超えた分は処理しない', () => {
    const fx = blueprintFixture().place([0, 0, 0], 'create:millstone')
    // 256 RPM の石臼は 120 個/分（2 個/秒）
    const both = trace(fx, [port([0, 0, 0], 'minecraft:wheat', 0.5), port([0, 0, 0], 'minecraft:wheat', 0.5)], { '0,0,0': 256 }).result
    expect(at(both, '0,0,0')?.recipes).toHaveLength(1)
    expect(sinkOf(both, '0,0,0', 'create:wheat_flour')).toBe(1.5)
    const over = trace(fx, [port([0, 0, 0], 'minecraft:wheat', 10), port([0, 0, 0], 'minecraft:wheat', 1)], { '0,0,0': 256 }).result
    expect(sinkOf(over, '0,0,0', 'create:wheat_flour')).toBe(3)
    expect(over.issues).toHaveLength(1)
  })

  it('[TP-RECIPE-TIE][TP-PATH-NO-RECIPE] 通り道でも合うレシピが2つ以上なら仮定に載せる。できる物のないレシピでは止まる', () => {
    const book: RecipeBook = {
      recipes: [
        recipe('pack:milling/b', 'milling', ['minecraft:wheat'], 100, [out('minecraft:sugar')]),
        recipe('pack:milling/a', 'milling', ['minecraft:wheat'], 100, [out('create:wheat_flour')]),
        recipe('pack:milling/empty', 'milling', ['minecraft:stick'], 100, []),
      ],
      scriptsChangeRecipes: true,
      itemTags: {},
    }
    const fx = blueprintFixture().place([0, 0, 0], 'create:millstone').place([2, 0, 0], 'create:millstone')
    const { result, log } = trace(fx, [port([0, 0, 0], 'minecraft:wheat'), port([2, 0, 0], 'minecraft:stick')], { '0,0,0': 256, '2,0,0': 256 }, book)
    expect(at(result, '0,0,0')?.recipes[0]?.choice.recipe?.id).toBe('pack:milling/a')
    expect(messages(log).some((m) => m.includes('pack:milling/a'))).toBe(true)
    expect(messages(log).some((m) => m.startsWith('KubeJS のスクリプトがレシピを変えているが'))).toBe(true)
    expect(at(result, '2,0,0')?.notes).toContain('レシピ pack:milling/empty にできる物がないので、物はここで止まる')
    expect(itemPathValues(at(result, '2,0,0')!).find((v) => v.label === 'レシピ')?.value.value).toBe(
      'pack:milling/empty（minecraft:stick → できる物なし）',
    )
    expect(itemPathValues(at(result, '2,0,0')!).find((v) => v.label === '物の通り道')).toBeDefined()
  })

  it('[TP-BLOCK-ARM] 読めない点（Pos がない・Mode が違う）は飛ばす。回転数がなければ運ばない', () => {
    const points = nbt.list('compound', [
      nbt.compound({ Mode: nbt.string('TAKE') }),
      nbt.compound({ Pos: nbt.intArray([0, 0, 1]), Mode: nbt.string('OTHER') }),
      nbt.compound({ Pos: nbt.intArray([-1, 0, 0]), Mode: nbt.string('TAKE') }),
      nbt.compound({ Pos: nbt.intArray([1, 0, 0]), Mode: nbt.string('DEPOSIT') }),
    ])
    const fx = blueprintFixture()
      .place([1, 0, 0], 'create:mechanical_arm', nbt.compound({ InteractionPoints: points }))
      .place([0, 0, 0], 'minecraft:chest', chest)
      .place([2, 0, 0], 'create:depot')
      .place([1, 0, 1], 'minecraft:chest', chest)
    const moving = trace(fx, [port([0, 0, 0], 'minecraft:stone')], { '1,0,0': 64 }).result
    expect(sinkOf(moving, '2,0,0', 'minecraft:stone')).toBe(1)
    expect(at(moving, '1,0,1')).toBeUndefined()
    const stopped = trace(fx, [port([0, 0, 0], 'minecraft:stone')]).result
    expect(at(stopped, '1,0,0')?.notes).toContain('止まっているので、物を運ばない')
    expect(sinkOf(stopped, '0,0,0', 'minecraft:stone')).toBe(1)
  })
})

describe('ラージチェスト・フィルター・真鍮のトンネル・ベルトから取る機械アーム（#253）', () => {
  /** 1.18.2 のアイテムスタック（フィルターの物） */
  const stack = (id: string) => nbt.compound({ id: nbt.string(id), Count: nbt.byte(1) })
  const filterOf = (id: string) => nbt.compound({ Filter: stack(id), FilterAmount: nbt.int(64) })
  /** 真鍮のトンネルの生データ。sides・flaps は Minecraft の 3D の番号（2 北・3 南・4 西・5 東） */
  const tunnel = (flaps: number[], sides: number[], filters: { side: number; filter: NbtCompound }[] = []) =>
    nbt.compound({
      Flaps: nbt.list('int', flaps.map((d) => nbt.int(d))),
      Sides: nbt.list('int', sides.map((d) => nbt.int(d))),
      ConnectedLeft: nbt.byte(0),
      ConnectedRight: nbt.byte(0),
      Filters: nbt.list(
        'compound',
        filters.map((f) => nbt.compound({ Side: nbt.int(f.side), Filter: f.filter, FilterAmount: nbt.int(64) })),
      ),
    })
  const blacklist = (id: string) =>
    nbt.compound({
      id: nbt.string('create:filter'),
      Count: nbt.byte(1),
      tag: nbt.compound({
        Blacklist: nbt.byte(1),
        Items: nbt.compound({ Items: nbt.list('compound', [nbt.compound({ Slot: nbt.int(0), id: nbt.string(id), Count: nbt.byte(1) })]) }),
      }),
    })

  it('[TP-BLOCK-DOUBLE-CHEST] ラージチェストは2つの半分で1つの入れ物。片方に入れた物を、もう片方のファンネルが取り出す', () => {
    // 西向きのラージチェスト：left (1,1,1) の時計回り（北）に right (1,1,0)
    const fx = () =>
      blueprintFixture({ size: [3, 2, 3] })
        .place([1, 1, 1], 'minecraft:chest', { facing: 'west', type: 'left', waterlogged: 'false' }, chest)
        .place([1, 1, 2], 'create:andesite_funnel', { facing: 'south', extracting: 'true', powered: 'false' })
        .place([1, 0, 2], 'create:depot')
    const half = (props: Record<string, string>) => fx().place([1, 1, 0], 'minecraft:chest', { waterlogged: 'false', ...props }, chest)
    const paired = trace(half({ facing: 'west', type: 'right' }), [port([1, 1, 0], 'minecraft:stone')]).result
    expect(sinkOf(paired, '1,0,2', 'minecraft:stone')).toBe(1)
    expect(sinkOf(paired, '1,1,0', 'minecraft:stone')).toBe(0)
    // 向きか type が合わなければ別の入れ物
    expect(sinkOf(trace(half({ facing: 'west', type: 'single' }), [port([1, 1, 0], 'minecraft:stone')]).result, '1,1,0', 'minecraft:stone')).toBe(1)
    expect(sinkOf(trace(half({ facing: 'east', type: 'right' }), [port([1, 1, 0], 'minecraft:stone')]).result, '1,1,0', 'minecraft:stone')).toBe(1)
    // 取り出すファンネルの付いた半分に入れても同じ
    expect(sinkOf(trace(half({ facing: 'west', type: 'right' }), [port([1, 1, 1], 'minecraft:stone')]).result, '1,0,2', 'minecraft:stone')).toBe(1)
  })

  it('[TP-FILTER] ファンネルのフィルター：入れるファンネルは合わない物を受け取らず、取り出すファンネルは合う物だけを取り出す', () => {
    const fx = blueprintFixture({ size: [4, 4, 3] })
      // 取り出すファンネルが真下の入れるファンネル（上向き）に落とす。銅のインゴットだけを受け取る
      .place([1, 3, 0], 'minecraft:chest', chest)
      .place([1, 3, 1], 'create:andesite_funnel', { facing: 'south', extracting: 'true', powered: 'false' })
      .place([1, 2, 1], 'create:brass_funnel', { facing: 'up', extracting: 'false', powered: 'false' }, filterOf('minecraft:copper_ingot'))
      .place([1, 1, 1], 'minecraft:chest', chest)
      // 石だけを取り出すファンネル
      .place([3, 3, 0], 'minecraft:chest', chest)
      .place([3, 3, 1], 'create:brass_funnel', { facing: 'south', extracting: 'true', powered: 'false' }, filterOf('minecraft:stone'))
      .place([3, 2, 1], 'create:depot')
    expect(sinkOf(trace(fx, [port([1, 3, 0], 'minecraft:copper_ingot')]).result, '1,1,1', 'minecraft:copper_ingot')).toBe(1)
    const raw = trace(fx, [port([1, 3, 0], 'minecraft:raw_copper')])
    expect(sinkOf(raw.result, '1,1,1', 'minecraft:raw_copper')).toBe(0)
    expect(messages(raw.log)).toContain('minecraft:raw_copper はファンネルのフィルターに合わないので、ファンネルは受け取らず、物はここで止まる')
    expect(sinkOf(trace(fx, [port([3, 3, 0], 'minecraft:stone')]).result, '3,2,1', 'minecraft:stone')).toBe(1)
    // 合わない物は取り出さないので、入れ物に溜まる
    expect(sinkOf(trace(fx, [port([3, 3, 0], 'minecraft:dirt')]).result, '3,3,0', 'minecraft:dirt')).toBe(1)
  })

  it('[TP-FILTER] ベルトのファンネルのフィルター：取り込むファンネルは合わない物を通り過ぎさせ、押し出すファンネルは合う物だけを置く', () => {
    const fx = () => {
      const f = blueprintFixture({ size: [5, 3, 3] })
      belt(f, 0, 1, [0, 1, 2], 'east')
      return f
        .place([1, 1, 1], 'create:brass_belt_funnel', { facing: 'north', shape: 'pulling', powered: 'false' }, filterOf('minecraft:stone'))
        .place([1, 1, 2], 'minecraft:chest', chest)
        .place([3, 0, 1], 'minecraft:chest', chest)
    }
    const speeds = { '0,0,1': -24, '1,0,1': -24, '2,0,1': -24 }
    expect(sinkOf(trace(fx(), [port([0, 0, 1], 'minecraft:stone')], speeds).result, '1,1,2', 'minecraft:stone')).toBe(1)
    const dirt = trace(fx(), [port([0, 0, 1], 'minecraft:dirt')], speeds).result
    expect(sinkOf(dirt, '1,1,2', 'minecraft:dirt')).toBe(0)
    expect(sinkOf(dirt, '3,0,1', 'minecraft:dirt')).toBe(1)

    // 押し出すベルトのファンネル（平行の形、ベルトは東へ）：西のデポから溶岩のバケツだけを取り出して下のベルトへ
    const push = () => {
      const f = blueprintFixture({ size: [5, 3, 3] })
      belt(f, 0, 1, [1, 2], 'east')
      return f
        .place([0, 1, 1], 'create:depot')
        .place([1, 1, 1], 'create:brass_belt_funnel', { facing: 'east', shape: 'retracted', powered: 'false' }, filterOf('minecraft:lava_bucket'))
        .place([3, 0, 1], 'minecraft:chest', chest)
    }
    const pushSpeeds = { '1,0,1': -24, '2,0,1': -24 }
    expect(sinkOf(trace(push(), [port([0, 1, 1], 'minecraft:lava_bucket')], pushSpeeds).result, '3,0,1', 'minecraft:lava_bucket')).toBe(1)
    expect(sinkOf(trace(push(), [port([0, 1, 1], 'minecraft:bucket')], pushSpeeds).result, '0,1,1', 'minecraft:bucket')).toBe(1)
  })

  it('[TP-BRASS-TUNNEL] 真鍮のトンネル：ベルトの軸の口（Flaps）しかなければ分けずに素通りし、口（Sides）にない横には分けない（#253）', () => {
    const fx = (be: NbtCompound) => {
      const f = blueprintFixture({ size: [4, 2, 3] })
      belt(f, 0, 1, [0, 1, 2], 'east')
      return f
        .place([1, 1, 1], 'create:brass_tunnel', { axis: 'x', shape: 'straight' }, be)
        .place([1, 0, 0], 'create:depot')
        .place([3, 0, 1], 'minecraft:chest', chest)
    }
    const speeds = { '0,0,1': -24, '1,0,1': -24, '2,0,1': -24 }
    const run = (be: NbtCompound) => trace(fx(be), [port([0, 0, 1], 'minecraft:stone')], speeds).result
    const straight = run(tunnel([4, 5], [4, 5]))
    expect(sinkOf(straight, '3,0,1', 'minecraft:stone')).toBe(1)
    expect(sinkOf(straight, '1,0,0', 'minecraft:stone')).toBe(0)
    // 預からないので 10 tick 待たない
    expect(straight.moves.find((m) => m.to.join(',') === '1,0,1')?.hold ?? 0).toBe(0)
    expect(rateOf(straight, '1,1,1', 'minecraft:stone')).toBe(1)
    // 北に口があれば分ける
    const open = run(tunnel([2, 4, 5], [2, 4, 5]))
    expect(sinkOf(open, '3,0,1', 'minecraft:stone')).toBe(0.5)
    expect(sinkOf(open, '1,0,0', 'minecraft:stone')).toBe(0.5)
    // 口（Sides）に北がなければ、北のデポには分けない
    const closed = run(tunnel([2, 4, 5], [4, 5]))
    expect(sinkOf(closed, '3,0,1', 'minecraft:stone')).toBe(1)
    expect(sinkOf(closed, '1,0,0', 'minecraft:stone')).toBe(0)
    // 出る側のフィルターに合わない出口には分けない。先（東）がだめなら横へ全部
    const eastFiltered = run(tunnel([2, 4, 5], [2, 4, 5], [{ side: 5, filter: stack('minecraft:dirt') }]))
    expect(sinkOf(eastFiltered, '1,0,0', 'minecraft:stone')).toBe(1)
    expect(sinkOf(eastFiltered, '3,0,1', 'minecraft:stone')).toBe(0)
    // どこにも出せなければ止まる
    const none = run(tunnel([2, 4, 5], [4, 5], [{ side: 5, filter: stack('minecraft:dirt') }]))
    expect(at(none, '1,0,1')?.notes).toContain('真鍮のトンネルに物を出せる口がないので、物はここで止まる')
  })

  it('[TP-BRASS-TUNNEL-FILTER][TP-BLOCK-ARM-BELT] トンネルの入る側のフィルターに合わない物は手前の区間で止まり、そこを取る機械アームが全部取る', () => {
    const points = nbt.list('compound', [
      nbt.compound({ Pos: nbt.intArray([0, -1, -1]), Mode: nbt.string('TAKE') }),
      nbt.compound({ Pos: nbt.intArray([0, -1, 1]), Mode: nbt.string('DEPOSIT') }),
    ])
    const fx = (arm: boolean) => {
      const f = blueprintFixture({ size: [5, 3, 4] })
      belt(f, 0, 1, [0, 1, 2, 3], 'east')
      f.place([2, 1, 1], 'create:brass_tunnel', { axis: 'x', shape: 'straight' }, tunnel([4, 5], [4, 5], [{ side: 4, filter: blacklist('minecraft:lava_bucket') }]))
      f.place([4, 0, 1], 'minecraft:chest', chest)
      if (arm) {
        f.place([1, 1, 2], 'create:mechanical_arm', { ceiling: 'false' }, nbt.compound({ InteractionPoints: points }))
        f.place([1, 0, 3], 'create:blaze_burner', { blaze: 'kindled', facing: 'west' })
      }
      return f
    }
    const speeds = { '0,0,1': -24, '1,0,1': -24, '2,0,1': -24, '3,0,1': -24, '1,1,2': 64 }
    // 合う物はトンネルを通る
    expect(sinkOf(trace(fx(false), [port([0, 0, 1], 'minecraft:stone')], speeds).result, '4,0,1', 'minecraft:stone')).toBe(1)
    // 合わない物は手前の区間 (1,0,1) で止まる
    const stuck = trace(fx(false), [port([0, 0, 1], 'minecraft:lava_bucket')], speeds).result
    expect(sinkOf(stuck, '4,0,1', 'minecraft:lava_bucket')).toBe(0)
    expect(rateOf(stuck, '2,0,1', 'minecraft:lava_bucket')).toBe(0)
    expect(at(stuck, '1,0,1')?.notes).toContain('次の区間の真鍮のトンネルのフィルターに合わないので、物はここで止まる')
    // 手前の区間を取る機械アームが全部取り、バーナーへ
    const taken = trace(fx(true), [port([0, 0, 1], 'minecraft:lava_bucket')], speeds).result
    expect(rateOf(taken, '1,0,3', 'minecraft:lava_bucket')).toBe(1)
    expect(taken.moves.some((m) => m.from.join(',') === '1,0,1' && m.to.join(',') === '1,0,3')).toBe(true)
    // 止まらない物は、先へ進む物とアームで等しく分ける
    const { result: shared, log } = trace(fx(true), [port([0, 0, 1], 'minecraft:stone')], speeds)
    expect(rateOf(shared, '1,0,3', 'minecraft:stone')).toBe(0.5)
    expect(sinkOf(shared, '4,0,1', 'minecraft:stone')).toBe(0.5)
    expect(messages(log)).toContain('機械アームがベルトの区間から取る数は、先へ進む物と等しく分けるとした')
  })
})

describe('扇風機の処理（#235）', () => {
  const stack = (id: string) => nbt.compound({ id: nbt.string(id), Count: nbt.byte(1) })
  const filterOf = (id: string) => nbt.compound({ Filter: stack(id), FilterAmount: nbt.int(64) })
  const moveOf = (r: ItemPathResult, from: string, to: string, item: string) =>
    r.moves.find((m) => m.from.join(',') === from && m.to.join(',') === to && m.item === item)
  const FAN_BOOK: RecipeBook = {
    ...BOOK,
    recipes: [
      ...BOOK.recipes,
      recipe('minecraft:copper_ingot_from_smelting_raw_copper', 'smelting', ['minecraft:raw_copper'], 0, [out('minecraft:copper_ingot')]),
      recipe('minecraft:iron_ingot_from_blasting_iron_ore', 'blasting', ['minecraft:iron_ore'], 0, [out('minecraft:iron_ingot')]),
      recipe('minecraft:cooked_beef', 'smelting', ['minecraft:beef'], 0, [out('minecraft:cooked_beef')]),
      recipe('minecraft:cooked_beef_from_smoking', 'smoking', ['minecraft:beef'], 0, [out('minecraft:cooked_beef')]),
      recipe('create:splashing/gravel', 'splashing', ['minecraft:gravel'], 0, [out('minecraft:flint', 1, 0.25), out('minecraft:iron_nugget', 1, 0.125)]),
      recipe('create:haunting/sand', 'haunting', ['minecraft:sand'], 0, [out('minecraft:soul_sand')]),
    ],
  }
  const FAN_TICKS = 151

  /**
   * 真鍮製造機の形：チェスト (1,2,1) → 取り出すファンネル (1,2,2)（南向き）が真下の上向きのファンネル (1,1,2) に落とす。
   * 上向きのファンネルはインゴットだけを通し、下のチェスト (1,0,2) へ。扇風機 (0,1,2) は東向きで、溶岩 (2,1,2)
   */
  function brassMaker(): BlueprintFixture {
    return blueprintFixture({ size: [8, 3, 3] })
      .place([1, 2, 1], 'minecraft:chest', chest)
      .place([1, 2, 2], 'create:andesite_funnel', { facing: 'south', extracting: 'true', powered: 'false' })
      .place([1, 1, 2], 'create:brass_funnel', { facing: 'up', extracting: 'false', powered: 'false' }, filterOf('minecraft:copper_ingot'))
      .place([1, 0, 2], 'minecraft:chest', chest)
      .place([0, 1, 2], 'create:encased_fan', { facing: 'east' })
      .place([2, 1, 2], 'minecraft:lava', { level: '0' })
  }

  it('[TP-FAN-DROPPED][TP-FAN-RECIPE] 落ちた物がファンネルのフィルターに断られて風の中にとどまると、焼いてからもう一度渡す', () => {
    // -32 RPM の東向きは引く風。溶岩から扇風機の方のマス（上向きのファンネル）が焼く
    const { result, log } = trace(brassMaker(), [port([1, 2, 1], 'minecraft:raw_copper')], { '0,1,2': -32 }, FAN_BOOK)
    expect(sinkOf(result, '1,0,2', 'minecraft:copper_ingot')).toBe(1)
    expect(sinkOf(result, '1,0,2', 'minecraft:raw_copper')).toBe(0)
    const funnel = at(result, '1,1,2')!
    expect(funnel.arrivals.map((a) => a.item)).toEqual(['minecraft:raw_copper', 'minecraft:copper_ingot'])
    expect(funnel.recipes).toMatchObject([{ type: 'smelting', input: 'minecraft:raw_copper', outputs: [{ item: 'minecraft:copper_ingot', rate: 1 }] }])
    // 落ちる動きのあと、焼く間 151 tick とどまる
    expect(moveOf(result, '1,2,2', '1,1,2', 'minecraft:raw_copper')?.hold).toBeCloseTo(FAN_TICKS / 20)
    expect(messages(log).some((m) => m.includes('フィルターに合わない'))).toBe(false)

    // 押す風では、溶岩より遠い方だけが焼く。ファンネルのマスは風の中だが何もしないので、断られて止まる
    const pushed = trace(brassMaker(), [port([1, 2, 1], 'minecraft:raw_copper')], { '0,1,2': 32 }, FAN_BOOK)
    expect(sinkOf(pushed.result, '1,0,2', 'minecraft:copper_ingot')).toBe(0)
    expect(messages(pushed.log)).toContain('minecraft:raw_copper はファンネルのフィルターに合わないので、ファンネルは受け取らず、物はここで止まる')

    // Modpack がなければ、できる物が分からないので変わらないとする
    const noPack = trace(brassMaker(), [port([1, 2, 1], 'minecraft:raw_copper')], { '0,1,2': -32 }, null)
    expect(messages(noPack.log)).toContain('Modpack のレシピがないので、扇風機で焼くとできる物が分からず、物は変わらないとした')
    expect(messages(noPack.log)).toContain('minecraft:raw_copper はファンネルのフィルターに合わないので、ファンネルは受け取らず、物はここで止まる')
  })

  it('[TP-FAN-DROPPED] 受け取るブロックがそのまま受け取る物は処理しない', () => {
    // フィルターに合うインゴットは、ファンネルがすぐ吸い込む
    const { result } = trace(brassMaker(), [port([1, 2, 1], 'minecraft:copper_ingot')], { '0,1,2': -32 }, FAN_BOOK)
    expect(sinkOf(result, '1,0,2', 'minecraft:copper_ingot')).toBe(1)
    expect(at(result, '1,1,2')?.recipes).toEqual([])
  })

  /** 東向きの扇風機 (0,1,0) の前に触媒 (1,1,0)、1段下にデポ (2,0,0) */
  function depotUnder(catalyst: string, props: Record<string, string>): BlueprintFixture {
    return blueprintFixture({ size: [5, 2, 1] })
      .place([0, 1, 0], 'create:encased_fan', { facing: 'east' })
      .place([1, 1, 0], catalyst, props)
      .place([2, 0, 0], 'create:depot')
  }

  it('[TP-FAN-ON-BELT][TP-FAN-RECIPE] 水平の風の1段下のデポの物を処理し、151 tick とどまる。洗う・燻す・憑依', () => {
    const wash = trace(depotUnder('minecraft:water', { level: '0' }), [port([2, 0, 0], 'minecraft:gravel')], { '0,1,0': 64 }, FAN_BOOK)
    expect(sinkOf(wash.result, '2,0,0', 'minecraft:flint')).toBe(0.25)
    expect(sinkOf(wash.result, '2,0,0', 'minecraft:iron_nugget')).toBe(0.125)
    expect(sinkOf(wash.result, '2,0,0', 'minecraft:gravel')).toBe(0)
    expect(moveOf(wash.result, '2,0,0', '2,0,0', 'minecraft:gravel')?.hold).toBeCloseTo(FAN_TICKS / 20)

    const smoke = trace(
      depotUnder('minecraft:campfire', { lit: 'true', waterlogged: 'false' }),
      [port([2, 0, 0], 'minecraft:beef')],
      { '0,1,0': 64 },
      FAN_BOOK,
    )
    expect(sinkOf(smoke.result, '2,0,0', 'minecraft:cooked_beef')).toBe(1)
    expect(at(smoke.result, '2,0,0')?.recipes[0]?.type).toBe('smoking')

    const haunt = trace(depotUnder('minecraft:soul_fire', {}), [port([2, 0, 0], 'minecraft:sand')], { '0,1,0': 64 }, FAN_BOOK)
    expect(sinkOf(haunt.result, '2,0,0', 'minecraft:soul_sand')).toBe(1)

    // レシピのない物は変わらない
    const plain = trace(depotUnder('minecraft:water', { level: '0' }), [port([2, 0, 0], 'minecraft:stone')], { '0,1,0': 64 }, FAN_BOOK)
    expect(sinkOf(plain.result, '2,0,0', 'minecraft:stone')).toBe(1)
    expect(at(plain.result, '2,0,0')?.notes).toContain('minecraft:stone を洗うレシピがないので、物は変わらない')
    // 扇風機が止まっていれば処理しない
    const stopped = trace(depotUnder('minecraft:water', { level: '0' }), [port([2, 0, 0], 'minecraft:gravel')], {}, FAN_BOOK)
    expect(sinkOf(stopped.result, '2,0,0', 'minecraft:gravel')).toBe(1)
  })

  it('[TP-FAN-RECIPE] 焼く：smelting、なければ blasting。燻すレシピが同じ物を作る物と、レシピのない物は焼けてなくなる', () => {
    const lava = depotUnder('minecraft:lava', { level: '0' })
    const run = (item: string) => trace(lava, [port([2, 0, 0], item)], { '0,1,0': 64 }, FAN_BOOK)
    const copper = run('minecraft:raw_copper')
    expect(sinkOf(copper.result, '2,0,0', 'minecraft:copper_ingot')).toBe(1)
    expect(at(copper.result, '2,0,0')?.recipes[0]?.type).toBe('smelting')
    const iron = run('minecraft:iron_ore')
    expect(sinkOf(iron.result, '2,0,0', 'minecraft:iron_ingot')).toBe(1)
    expect(at(iron.result, '2,0,0')?.recipes[0]?.type).toBe('blasting')

    const beef = run('minecraft:beef')
    expect(at(beef.result, '2,0,0')?.sinks).toEqual([])
    expect(at(beef.result, '2,0,0')?.notes).toContain('minecraft:beef は扇風機の風で焼けてなくなる')
    const stick = run('minecraft:stick')
    expect(at(stick.result, '2,0,0')?.sinks).toEqual([])
    expect(messages(stick.log)).toContain('minecraft:stick を焼くレシピがないので、燃えない物ではないとして、焼けてなくなるとした')
  })

  it('[TP-FAN-ON-BELT] ベルトの物は止まらず、風の中を続けて通った時間が 151 tick に届いた区間で変わる。届かなければ変わらない', () => {
    // 東向きの扇風機 (0,1,0) の前に水 (1,1,0)。1段下に東へ進むベルト x = 2..9、端の先にチェスト (10,0,0)
    const fx = blueprintFixture({ size: [11, 2, 1] })
      .place([0, 1, 0], 'create:encased_fan', { facing: 'east' })
      .place([1, 1, 0], 'minecraft:water', { level: '0' })
      .place([10, 0, 0], 'minecraft:chest', chest)
    belt(fx, 0, 0, [2, 3, 4, 5, 6, 7, 8, 9], 'east')
    const speeds = (beltRpm: number): Record<string, number> => {
      const s: Record<string, number> = { '0,1,0': 256 }
      for (let x = 2; x <= 9; x++) s[`${x},0,0`] = beltRpm
      return s
    }
    // −16 RPM（X 軸のベルトは負の回転数で東へ進む）：区間1つ 30 tick。6 つ目の区間（x = 7）で 180 tick になって洗う
    const slow = trace(fx, [port([2, 0, 0], 'minecraft:gravel')], speeds(-16), FAN_BOOK)
    expect(at(slow.result, '7,0,0')?.recipes[0]).toMatchObject({ type: 'splashing', input: 'minecraft:gravel' })
    expect(sinkOf(slow.result, '10,0,0', 'minecraft:flint')).toBe(0.25)
    expect(sinkOf(slow.result, '10,0,0', 'minecraft:gravel')).toBe(0)
    expect(rateOf(slow.result, '10,0,0', 'minecraft:flint')).toBe(0.25)
    // ベルトの上では止まらない
    expect(slow.result.moves.every((m) => m.hold === 0)).toBe(true)

    // −32 RPM：区間1つ 15 tick、8 区間で 120 tick。届かないので変わらない
    const fast = trace(fx, [port([2, 0, 0], 'minecraft:gravel')], speeds(-32), FAN_BOOK)
    expect(sinkOf(fast.result, '10,0,0', 'minecraft:gravel')).toBe(1)
    expect(at(fast.result, '9,0,0')?.notes).toContain('風の中を通る時間が 120 tick で、洗うのにかかる 151 tick に届かないので、物は変わらずに通り過ぎる')
  })
})

describe('スパウトとアイテムドレイン（#235）', () => {
  const FLUID_BOOK: RecipeBook = {
    ...BOOK,
    recipes: [
      ...BOOK.recipes,
      {
        ...recipe('create:filling/honey_bottle', 'filling', ['minecraft:glass_bottle'], 0, [out('minecraft:honey_bottle')]),
        fluids: [],
        fluidTags: ['c:honey'],
      },
      recipe('create:emptying/honey_bottle', 'emptying', ['minecraft:honey_bottle'], 0, [out('minecraft:glass_bottle')]),
    ],
  }
  const tank = (id: string) =>
    nbt.compound({
      Tanks: nbt.list('compound', [nbt.compound({ TankContent: nbt.compound({ id: nbt.string(id), amount: nbt.int(1000) }) })]),
    })
  const pipe = (open: string[]) => {
    const props: Record<string, string> = { waterlogged: 'false' }
    for (const d of ['north', 'south', 'east', 'west', 'up', 'down']) props[d] = open.includes(d) ? 'true' : 'false'
    return props
  }

  /** デポ (0,0,0) の2段上にスパウト (0,2,0) */
  const spoutOnDepot = (spoutData?: NbtCompound) =>
    blueprintFixture({ size: [4, 5, 2] }).place([0, 0, 0], 'create:depot').place([0, 2, 0], 'create:spout', {}, spoutData)

  it('[TP-SPOUT] 材料と液体のタグに合う create:filling のレシピを使う（1.21 のタンクの形）', () => {
    const { result, log } = trace(spoutOnDepot(tank('create:honey')), [port([0, 0, 0], 'minecraft:glass_bottle')], {}, FLUID_BOOK)
    expect(sinkOf(result, '0,0,0', 'minecraft:honey_bottle')).toBe(1)
    expect(at(result, '0,2,0')?.recipes[0]?.choice.duration).toEqual({ value: 20, source: 'modpack', note: 'create:filling/honey_bottle' })
    expect(messages(log)).toEqual([])
  })

  it('[TP-SPOUT-FLUID] タンクが空なら、ポンプと管をたどり、鍾乳石が溶岩を垂らす大釜の液体を使う。バケツは溶岩入りバケツになる', () => {
    // スパウト (0,2,0) → ポンプ (1,2,0) → 管 (2,2,0)（西・下）→ 管 (2,1,0)（上・東）→ 大釜 (3,1,0)。大釜の上に鍾乳石・石・溶岩
    const fx = spoutOnDepot()
      .place([1, 2, 0], 'create:mechanical_pump', { facing: 'east', waterlogged: 'false' })
      .place([2, 2, 0], 'create:fluid_pipe', pipe(['west', 'down']))
      .place([2, 1, 0], 'create:fluid_pipe', pipe(['up', 'east']))
      .place([3, 1, 0], 'minecraft:cauldron')
      .place([3, 2, 0], 'minecraft:pointed_dripstone', { vertical_direction: 'down', thickness: 'tip', waterlogged: 'false' })
      .place([3, 3, 0], 'minecraft:stone')
      .place([3, 4, 0], 'minecraft:lava', { level: '0' })
    const { result, log } = trace(fx, [port([0, 0, 0], 'minecraft:bucket')], {}, FLUID_BOOK)
    expect(sinkOf(result, '0,0,0', 'minecraft:lava_bucket')).toBe(1)
    expect(messages(log)).toEqual(['スパウトのタンクが空なので、つながった管の先の minecraft:lava が入るとした'])
    // 管の口の先に水の水源もあれば、名前順で最初の溶岩を使う
    fx.place([2, 0, 0], 'minecraft:water', { level: '0' }).place([2, 1, 0], 'create:fluid_pipe', pipe(['up', 'east', 'down']))
    const two = trace(fx, [port([0, 0, 0], 'minecraft:bucket')], {}, FLUID_BOOK)
    expect(sinkOf(two.result, '0,0,0', 'minecraft:lava_bucket')).toBe(1)
    expect(messages(two.log)).toEqual([
      'スパウトのタンクが空なので、つながった管の先の minecraft:lava が入るとした（見つかった液体は minecraft:lava・minecraft:water。名前順で最初のものを使った）',
    ])
  })

  it('[TP-SPOUT-VALVE] 管の途中のバルブは、回転の計算で回転数が正のときだけ液体を通す（#284）', () => {
    // スパウト (0,2,0) → バルブ (1,2,0)（facing=north、axis_along_first=false で x 軸の管）→ 溶岩の水源 (2,2,0)
    const fx = spoutOnDepot()
      .place([1, 2, 0], 'create:fluid_valve', { facing: 'north', axis_along_first: 'false', enabled: 'false', waterlogged: 'false' })
      .place([2, 2, 0], 'minecraft:lava', { level: '0' })
    const open = trace(fx, [port([0, 0, 0], 'minecraft:bucket')], { '1,2,0': 32 }, FLUID_BOOK)
    expect(sinkOf(open.result, '0,0,0', 'minecraft:lava_bucket')).toBe(1)
    const closed = trace(fx, [port([0, 0, 0], 'minecraft:bucket')], { '1,2,0': -32 }, FLUID_BOOK)
    expect(sinkOf(closed.result, '0,0,0', 'minecraft:bucket')).toBe(1)
  })

  it('[TP-SPOUT-FLUID] 液体が分からなければ、物は変わらず、止まらずに通る', () => {
    const { result, log } = trace(spoutOnDepot(), [port([0, 0, 0], 'minecraft:bucket')], {}, FLUID_BOOK)
    expect(sinkOf(result, '0,0,0', 'minecraft:bucket')).toBe(1)
    expect(messages(log)).toEqual([
      'スパウトの液体が分からない（タンクが空で、つながった管の先に液体が見つからない）ので、物は変わらずに通るとした',
    ])
  })

  it('[TP-SPOUT] 水・溶岩でない液体のバケツは <液体>_bucket として仮定に載せる。Modpack がなくても Create の決まりは使う', () => {
    const { result, log } = trace(spoutOnDepot(tank('create:chocolate')), [port([0, 0, 0], 'minecraft:bucket')], {}, null)
    expect(sinkOf(result, '0,0,0', 'create:chocolate_bucket')).toBe(1)
    expect(messages(log)).toEqual(['create:chocolate のバケツを create:chocolate_bucket とした'])
    const bottle = trace(spoutOnDepot(tank('create:honey')), [port([0, 0, 0], 'minecraft:glass_bottle')], {}, null)
    expect(sinkOf(bottle.result, '0,0,0', 'minecraft:glass_bottle')).toBe(1)
    expect(messages(bottle.log)).toEqual([
      'Modpack のレシピがないので、スパウトで minecraft:glass_bottle に液体を入れられるか分からず、物は変わらないとした',
    ])
  })

  it('[TP-ITEM-DRAIN] ポーションはガラス瓶、create:emptying のレシピに合う物はそのできる物になる。上から入れた物はドレインに置かれる', () => {
    const fx = blueprintFixture({ size: [1, 1, 1] }).place([0, 0, 0], 'create:item_drain')
    const potion = trace(fx, [port([0, 0, 0], 'minecraft:splash_potion')], {}, FLUID_BOOK)
    expect(sinkOf(potion.result, '0,0,0', 'minecraft:glass_bottle')).toBe(1)
    const honey = trace(fx, [port([0, 0, 0], 'minecraft:honey_bottle')], {}, FLUID_BOOK)
    expect(sinkOf(honey.result, '0,0,0', 'minecraft:glass_bottle')).toBe(1)
    expect(at(honey.result, '0,0,0')?.recipes[0]?.choice.recipe?.id).toBe('create:emptying/honey_bottle')
    // 2つの物の入口から同じ物が届けば、1つのレシピにまとめる。スクリプトがレシピを変えていれば仮定に載せる
    const twice = trace(fx, [port([0, 0, 0], 'minecraft:honey_bottle'), port([0, 0, 0], 'minecraft:honey_bottle')], {}, { ...FLUID_BOOK, scriptsChangeRecipes: true })
    expect(at(twice.result, '0,0,0')?.recipes).toHaveLength(1)
    expect(at(twice.result, '0,0,0')?.recipes[0]?.outputs).toEqual([{ item: 'minecraft:glass_bottle', rate: 2, source: 'virtual' }])
    expect(messages(twice.log)).toEqual(['KubeJS のスクリプトがレシピを変えているが、スクリプトのレシピは読めないので、物の通り道に入れていない'])
    const none = trace(fx, [port([0, 0, 0], 'minecraft:honey_bottle')], {}, null)
    expect(sinkOf(none.result, '0,0,0', 'minecraft:honey_bottle')).toBe(1)
    expect(messages(none.log)).toEqual([
      'Modpack のレシピがないので、アイテムドレインで minecraft:honey_bottle から液体を抜けるか分からず、物は変わらないとした',
    ])
  })
})

describe('メカニカルクラフター（#235）', () => {
  const ing = (items: string[], tags: string[] = []) => ({ items, tags })
  const shaped = (id: string, type: 'crafting_shaped' | 'mechanical_crafting', rows: (string | null)[][], result: string, mirrored = true): ProcessingRecipe => ({
    ...recipe(id, type, [], 0, [out(result)]),
    grid: { rows: rows.map((r) => r.map((c) => (c ? ing([c]) : null))), ingredients: [], mirrored },
  })
  const shapeless = (id: string, items: string[], result: string): ProcessingRecipe => ({
    ...recipe(id, 'crafting_shapeless', [], 0, [out(result)]),
    grid: { rows: null, ingredients: items.map((i) => ing([i])), mirrored: true },
  })
  const CRAFT_BOOK: RecipeBook = {
    ...BOOK,
    recipes: [
      ...BOOK.recipes,
      shaped('test:l', 'crafting_shaped', [['minecraft:iron_ingot', null], ['minecraft:iron_ingot', 'minecraft:gold_ingot']], 'test:l'),
      shaped('create:mechanical_crafting/pair', 'mechanical_crafting', [['create:andesite_alloy', 'minecraft:iron_ingot']], 'test:pair', false),
      shapeless('test:stick', ['minecraft:bamboo', 'minecraft:bamboo'], 'minecraft:stick'),
      shapeless('test:cake', ['minecraft:milk_bucket', 'minecraft:sugar'], 'test:cake'),
    ],
  }
  const crafter = (facing: string, pointing: string) => ({ facing, pointing, waterlogged: 'false' })
  const covered = nbt.compound({ Cover: nbt.byte(1) })
  const allAt = (positions: Vec3[], rpm: number) => Object.fromEntries(positions.map((p) => [p.join(','), rpm]))

  /**
   * 北向きの 2×2 のクラフター。(1,2,0)↓(1,1,0)→(0,1,0)↓チェスト (0,0,0)、(0,2,0)↓(0,1,0)。
   * 北向きでは右が西なので、並びの左は x=1。(0,2,0) はカバー付き（空きのマス）
   */
  const square = () =>
    blueprintFixture({ size: [2, 3, 1] })
      .place([0, 0, 0], 'minecraft:chest', chest)
      .place([0, 1, 0], 'create:mechanical_crafter', crafter('north', 'down'))
      .place([1, 1, 0], 'create:mechanical_crafter', crafter('north', 'right'))
      .place([0, 2, 0], 'create:mechanical_crafter', crafter('north', 'down'), covered)
      .place([1, 2, 0], 'create:mechanical_crafter', crafter('north', 'down'))
  const SQUARE: Vec3[] = [
    [0, 1, 0],
    [1, 1, 0],
    [0, 2, 0],
    [1, 2, 0],
  ]

  it('[TP-CRAFTER][TP-CRAFTER-GRID][TP-CRAFTER-RECIPE] 組のクラフターに材料がそろうと、並びに合うレシピで作り、矢印の先へ入れる', () => {
    const ports = [port([1, 2, 0], 'minecraft:iron_ingot'), port([1, 1, 0], 'minecraft:iron_ingot'), port([0, 1, 0], 'minecraft:gold_ingot', 0.1)]
    const { result, log } = trace(square(), ports, allAt(SQUARE, 32), CRAFT_BOOK)
    expect(sinkOf(result, '0,0,0', 'test:l')).toBeCloseTo(0.1)
    const applied = at(result, '0,1,0')?.recipes[0]
    // 一番長い道は 3 台：2 × (1 + 32) + (1 + 63) = 130 tick
    expect(applied?.choice.duration).toEqual({ value: 130, source: 'builtin', note: 'クラフター 3 台の道、速さ 32' })
    expect(applied).toMatchObject({ type: 'crafting_shaped', input: 'minecraft:gold_ingot ×1、minecraft:iron_ingot ×2' })
    expect(at(result, '0,1,0')?.notes).toContain('minecraft:iron_ingot のうち 0.9 個/秒は使われず、クラフターの前で詰まる')
    expect(result.moves.find((m) => m.to.join(',') === '0,0,0')).toMatchObject({ from: [0, 1, 0], item: 'test:l' })
    expect(messages(log)).toEqual([])
    // [TP-MOTION-CRAFTER] 材料は矢印に沿って 1 台ごとに (1 + 32) tick で渡り、受け取った材料も一緒に次へ渡す。できた物は作る間 (1 + 63) tick とどまる
    const pass = (from: string, to: string, item: string) => result.moves.find((m) => m.from.join(',') === from && m.to.join(',') === to && m.item === item)
    expect(pass('1,2,0', '1,1,0', 'minecraft:iron_ingot')).toMatchObject({ rate: 0.1, seconds: 33 / 20, hold: 0 })
    expect(pass('1,1,0', '0,1,0', 'minecraft:iron_ingot')).toMatchObject({ rate: 0.2, seconds: 33 / 20, hold: 0 })
    expect(result.moves.filter((m) => m.item === 'minecraft:gold_ingot')).toEqual([])
    expect(pass('0,1,0', '0,1,0', 'test:l')).toMatchObject({ seconds: 0, hold: 64 / 20 })
    // 1回にかかる時間で作れる数より多くは作れない
    const fast = trace(square(), ports.map((p) => ({ ...p, params: { rate: 5 } })), allAt(SQUARE, 32), CRAFT_BOOK)
    expect(sinkOf(fast.result, '0,0,0', 'test:l')).toBeCloseTo(20 / 130)
    // 左右を入れ替えた並びも合う（作業台の形のあるレシピ）
    const mirrored = square()
      .place([0, 2, 0], 'create:mechanical_crafter', crafter('north', 'down'))
      .place([1, 2, 0], 'create:mechanical_crafter', crafter('north', 'down'), covered)
    const m = trace(
      mirrored,
      [port([0, 2, 0], 'minecraft:iron_ingot'), port([0, 1, 0], 'minecraft:iron_ingot'), port([1, 1, 0], 'minecraft:gold_ingot')],
      allAt(SQUARE, 32),
      CRAFT_BOOK,
    )
    expect(sinkOf(m.result, '0,0,0', 'test:l')).toBeCloseTo(20 / 130)
    // 並びが合わなければ作らない
    const wrong = trace(square(), [port([1, 2, 0], 'minecraft:gold_ingot'), port([1, 1, 0], 'minecraft:iron_ingot'), port([0, 1, 0], 'minecraft:iron_ingot')], allAt(SQUARE, 32), CRAFT_BOOK)
    expect(at(wrong.result, '0,1,0')?.notes).toContain('材料の並びに合うレシピがないので、材料は放り出される')
    expect(at(wrong.result, '0,0,0')).toBeUndefined()
  })

  it('[TP-CRAFTER] 材料が届かないクラフター、止まっている組、Modpack がないときは組み立てない。カバー付きのクラフターは受け取らない', () => {
    const iron = [port([1, 2, 0], 'minecraft:iron_ingot'), port([1, 1, 0], 'minecraft:iron_ingot')]
    const missing = trace(square(), iron, allAt(SQUARE, 32), CRAFT_BOOK)
    expect(messages(missing.log)).toEqual(['材料が届かないクラフター（(0, 1, 0)）があるので、組み立てない'])
    const all = [...iron, port([0, 1, 0], 'minecraft:gold_ingot')]
    const stopped = trace(square(), all, { ...allAt(SQUARE, 32), '0,2,0': 0 }, CRAFT_BOOK)
    expect(at(stopped.result, '0,1,0')?.notes).toContain('止まっているので、組み立てない')
    const noPack = trace(square(), all, allAt(SQUARE, 32), null)
    expect(at(noPack.result, '0,1,0')?.recipesUnknown).toBe(true)
    expect(messages(noPack.log)).toEqual(['Modpack のレシピがないので、メカニカルクラフターでできる物が分からず、物の通り道はクラフターで止まる'])
    const cover = trace(square(), [port([0, 2, 0], 'minecraft:iron_ingot')], allAt(SQUARE, 32), CRAFT_BOOK)
    expect(rateOf(cover.result, '0,2,0', 'minecraft:iron_ingot')).toBe(0)
  })

  it('[TP-CRAFTER-GRID] 入力をつないだクラフターは、どれに入れても組の空いたクラフターに入る。矢印の先が空気なら前に放り出す', () => {
    // 南向き（右は東）。(0,1,0)→(1,1,0)↓ 空気 → 前（南）の (1,1,1) に放り出し、下のチェスト (1,0,1) へ
    const controller = nbt.compound({
      ConnectedInput: nbt.compound({
        Controller: nbt.byte(1),
        Data: nbt.list('compound', [nbt.compound({ X: nbt.int(0), Y: nbt.int(0), Z: nbt.int(0) }), nbt.compound({ X: nbt.int(1), Y: nbt.int(0), Z: nbt.int(0) })]),
      }),
    })
    const member = nbt.compound({
      ConnectedInput: nbt.compound({ Controller: nbt.byte(0), Data: nbt.list('compound', [nbt.compound({ X: nbt.int(-1), Y: nbt.int(0), Z: nbt.int(0) })]) }),
    })
    const fx = blueprintFixture({ size: [2, 2, 2] })
      .place([0, 1, 0], 'create:mechanical_crafter', crafter('south', 'right'), controller)
      .place([1, 1, 0], 'create:mechanical_crafter', crafter('south', 'down'), member)
      .place([1, 0, 1], 'minecraft:chest', chest)
    const speeds = allAt([[0, 1, 0], [1, 1, 0]], 256)
    const { result, log } = trace(fx, [port([1, 1, 0], 'minecraft:bamboo')], speeds, CRAFT_BOOK)
    // 1回に竹を2本使う
    expect(sinkOf(result, '1,0,1', 'minecraft:stick')).toBeCloseTo(0.5)
    expect(at(result, '1,1,0')?.notes).toContain('矢印の先にブロックがないので、できた物は前に放り出される')
    expect(messages(log)).toEqual(['出す先（(1, 1, 1)）が空気なので、物は下の (1, 0, 1) に落ちるとした'])
    // 2種類が届くと並びは分からないので、数と種類だけで決める。容器の残る材料はできた物と一緒に出る
    const two = trace(fx, [port([1, 1, 0], 'minecraft:milk_bucket'), port([0, 1, 0], 'minecraft:sugar')], speeds, CRAFT_BOOK)
    expect(sinkOf(two.result, '1,0,1', 'test:cake')).toBeCloseTo(1)
    expect(sinkOf(two.result, '1,0,1', 'minecraft:bucket')).toBeCloseTo(1)
    expect(at(two.result, '1,0,1')?.sinks[0]?.source).toBe('assumed')
    expect(messages(two.log)).toContain('入力をつないだクラフターに2種類以上の物が届くので、並びは分からず、材料の数と種類だけでレシピを決めた')
  })

  it('[TP-CRAFTER-RECIPE] メカニカルクラフターのレシピは、左右の入れ替えを受け付けないものもある', () => {
    // 南向き（右は東）：(0,1,0)→(1,1,0)↓ チェスト (1,0,0)。並びは 左 (0,1,0)、右 (1,1,0)
    const fx = blueprintFixture({ size: [2, 2, 1] })
      .place([0, 1, 0], 'create:mechanical_crafter', crafter('south', 'right'))
      .place([1, 1, 0], 'create:mechanical_crafter', crafter('south', 'down'))
      .place([1, 0, 0], 'minecraft:chest', chest)
    const speeds = allAt([[0, 1, 0], [1, 1, 0]], 64)
    const ok = trace(fx, [port([0, 1, 0], 'create:andesite_alloy'), port([1, 1, 0], 'minecraft:iron_ingot')], speeds, CRAFT_BOOK)
    expect(sinkOf(ok.result, '1,0,0', 'test:pair')).toBeGreaterThan(0)
    expect(at(ok.result, '1,1,0')?.recipes[0]?.type).toBe('mechanical_crafting')
    const swapped = trace(fx, [port([1, 1, 0], 'create:andesite_alloy'), port([0, 1, 0], 'minecraft:iron_ingot')], speeds, CRAFT_BOOK)
    expect(at(swapped.result, '1,1,0')?.notes).toContain('材料の並びに合うレシピがないので、材料は放り出される')
  })
})
