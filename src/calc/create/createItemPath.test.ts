import { describe, expect, it } from 'vitest'
import { blueprintFixture, type BlueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import type { Direction } from '../../domain/direction'
import { nbt } from '../../domain/nbt'
import type { Vec3 } from '../../domain/vec3'
import type { ProcessingRecipe, RecipeBook, RecipeResult } from '../../io/modpack/recipes'
import { AssumptionLog } from '../assumptionLog'
import type { CalcModpack } from '../calcPlugin'
import type { VirtualPort } from '../virtualPort'
import { bottleneckValue, itemPathValues, lineSummary, traceItemPaths, type ItemPathResult } from './createItemPath'
import { runCreateStress } from './createStressPlugin'
import { chooseRecipe } from './createThroughput'

const recipe = (
  id: string,
  type: ProcessingRecipe['type'],
  items: string[],
  duration: number,
  results: RecipeResult[],
  tags: string[] = [],
): ProcessingRecipe => ({ id, type, items, tags, duration, results })
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
const port = (pos: Vec3, face: Direction, item: string | null, rate = 1): VirtualPort => ({
  id: `p${++portCount}`,
  pos,
  face,
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
  it('材料はタグでも照らす', () => {
    const choice = chooseRecipe('crushing', ['minecraft:deepslate_iron_ore'], BOOK)
    expect(choice.recipe?.id).toBe('create:crushing/iron_ore')
    expect(choice.duration).toEqual({ value: 250, source: 'modpack', note: 'create:crushing/iron_ore' })
    expect(choice.assumption).toBeNull()
  })

  it('合うレシピが2つ以上なら ID の名前順で最初のものを使い、仮定に載せる', () => {
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
  it('例：小麦 → 石臼 → 小麦粉 → シュート → ベルト → デポに溜まる', () => {
    const fx = blueprintFixture()
      .place([1, 3, 0], 'create:millstone')
      .place([1, 2, 0], 'create:chute', { facing: 'down' })
      .place([3, 1, 0], 'create:depot')
    belt(fx, 1, 0, [1, 2], 'east')
    // 回転数 < 0、軸が X なので正の向き（east）に進む
    const { result } = trace(fx, [port([1, 3, 0], 'up', 'minecraft:wheat', 1)], { '1,3,0': 256, '1,1,0': -32, '2,1,0': -32 })
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

  it('ベルト：進む向きは (回転数 < 0) XOR (軸が X) なら負の向き。端の先の入れ物に渡す', () => {
    const fx = () =>
      belt(blueprintFixture().place([0, 0, 0], 'minecraft:chest', chest).place([4, 0, 0], 'minecraft:chest', chest), 0, 0, [1, 2, 3], 'east')
    const speeds = (rpm: number) => ({ '1,0,0': rpm, '2,0,0': rpm, '3,0,0': rpm })
    // 軸が X で回転数 > 0 なら負の向き（west）
    const west = trace(fx(), [port([2, 0, 0], 'up', 'minecraft:stone')], speeds(32)).result
    expect(sinkOf(west, '0,0,0', 'minecraft:stone')).toBe(1)
    expect(at(west, '4,0,0')).toBeUndefined()
    const east = trace(fx(), [port([2, 0, 0], 'up', 'minecraft:stone')], speeds(-32)).result
    expect(sinkOf(east, '4,0,0', 'minecraft:stone')).toBe(1)

    // 軸が Z なら回転数 > 0 で正の向き（south）
    const south = blueprintFixture()
      .place([0, 0, 0], 'create:belt', { facing: 'south', slope: 'horizontal', part: 'start' })
      .place([0, 0, 1], 'create:belt', { facing: 'south', slope: 'horizontal', part: 'end' })
      .place([0, 0, 2], 'minecraft:barrel', chest)
    expect(sinkOf(trace(south, [port([0, 0, 0], 'up', 'minecraft:stone')], { '0,0,0': 8, '0,0,1': 8 }).result, '0,0,2', 'minecraft:stone')).toBe(1)
  })

  it('ベルト：坂をたどり、端の先が空気なら下に落ちるとして仮定に載せる', () => {
    const fx = blueprintFixture({ size: [5, 3, 1] })
      .place([1, 0, 0], 'create:belt', { facing: 'east', slope: 'horizontal', part: 'start' })
      .place([2, 0, 0], 'create:belt', { facing: 'east', slope: 'upward', part: 'middle' })
      .place([3, 1, 0], 'create:belt', { facing: 'east', slope: 'horizontal', part: 'end' })
      .place([0, 0, 0], 'minecraft:chest', chest)
      .place([4, 0, 0], 'minecraft:chest', chest)
    const speeds = (rpm: number) => ({ '1,0,0': rpm, '2,0,0': rpm, '3,1,0': rpm })
    // 東へ：端（3,1,0）の先（4,1,0）は空気なので、下の（4,0,0）に落ちる
    const up = trace(fx, [port([1, 0, 0], 'up', 'minecraft:stone')], speeds(-16))
    expect(sinkOf(up.result, '4,0,0', 'minecraft:stone')).toBe(1)
    expect(at(up.result, '4,0,0')?.sinks[0]?.source).toBe('assumed')
    expect(messages(up.log)).toContain('出す先（(4, 1, 0)）が空気なので、物は下の (4, 0, 0) に落ちるとした')
    // 西へ：上の端から坂を下りて（0,0,0）へ
    const down = trace(fx, [port([3, 1, 0], 'up', 'minecraft:stone')], speeds(16))
    expect(sinkOf(down.result, '0,0,0', 'minecraft:stone')).toBe(1)
  })

  it('ベルト：止まっていればそこで止まる', () => {
    const fx = belt(blueprintFixture().place([3, 0, 0], 'minecraft:chest', chest), 0, 0, [0, 1, 2], 'east')
    const { result } = trace(fx, [port([0, 0, 0], 'up', 'minecraft:stone')], { '0,0,0': 0, '1,0,0': 0, '2,0,0': 0 })
    expect(rateOf(result, '0,0,0', 'minecraft:stone')).toBe(1)
    expect(at(result, '0,0,0')?.notes).toContain('止まっているので、物はここで止まる')
    expect(at(result, '3,0,0')).toBeUndefined()
  })

  it('ベルトの上の機械：2段上のプレスで押し、デプロイヤーは通すだけ。間にブロックがあれば処理しない', () => {
    const fx = belt(blueprintFixture().place([4, 0, 0], 'minecraft:chest', chest), 0, 0, [0, 1, 2, 3], 'east')
      .place([1, 2, 0], 'create:mechanical_press', { facing: 'north' })
      .place([2, 2, 0], 'create:deployer', { facing: 'down' })
      .place([3, 1, 0], 'minecraft:stone')
      .place([3, 2, 0], 'create:mechanical_press', { facing: 'north' })
    const speeds = { '0,0,0': -32, '1,0,0': -32, '2,0,0': -32, '3,0,0': -32, '1,2,0': 64, '2,2,0': 64, '3,2,0': 64 }
    const { result } = trace(fx, [port([0, 0, 0], 'up', 'minecraft:iron_ingot', 0.5)], speeds)
    expect(rateOf(result, '1,2,0', 'minecraft:iron_ingot')).toBe(0.5)
    expect(at(result, '1,2,0')?.recipes[0]?.choice.recipe?.id).toBe('create:pressing/iron_ingot')
    expect(rateOf(result, '2,2,0', 'create:iron_sheet')).toBe(0.5)
    // 間に石があるので、3つ目のプレスには届かない
    expect(at(result, '3,2,0')).toBeUndefined()
    expect(sinkOf(result, '4,0,0', 'create:iron_sheet')).toBe(0.5)
  })

  it('ベルトのファンネル：pulling なら下を通る物を取り込み、facing の反対側の入れ物に入れる', () => {
    const fx = belt(blueprintFixture().place([4, 0, 0], 'minecraft:chest', chest), 0, 0, [0, 1, 2, 3], 'east')
      .place([2, 1, 0], 'create:andesite_belt_funnel', { facing: 'north', shape: 'pulling', powered: 'false' })
      .place([2, 1, 1], 'minecraft:barrel', chest)
    const speeds = { '0,0,0': -32, '1,0,0': -32, '2,0,0': -32, '3,0,0': -32 }
    const { result } = trace(fx, [port([0, 0, 0], 'up', 'minecraft:stone')], speeds)
    expect(rateOf(result, '2,1,0', 'minecraft:stone')).toBe(1)
    expect(sinkOf(result, '2,1,1', 'minecraft:stone')).toBe(1)
    // 取り込んだ物は、ベルトの端の先には行かない
    expect(at(result, '4,0,0')).toBeUndefined()
  })

  it('ベルトのファンネル：進む向きの逆を向いていれば取り込む', () => {
    const fx = belt(blueprintFixture(), 0, 0, [0, 1, 2], 'east')
      .place([2, 1, 0], 'create:brass_belt_funnel', { facing: 'west', shape: 'extended', powered: 'false' })
      .place([3, 1, 0], 'minecraft:barrel', chest)
    const { result } = trace(fx, [port([0, 0, 0], 'up', 'minecraft:stone')], { '0,0,0': -8, '1,0,0': -8, '2,0,0': -8 })
    expect(sinkOf(result, '3,1,0', 'minecraft:stone')).toBe(1)
  })

  it('デポ：2段上のプレスで押し、1段上の pulling のベルトのファンネルで先へ', () => {
    const fx = blueprintFixture()
      .place([1, 0, 1], 'create:depot')
      .place([1, 1, 1], 'create:andesite_belt_funnel', { facing: 'north', shape: 'pulling', powered: 'false' })
      .place([1, 1, 2], 'minecraft:chest', chest)
      .place([1, 2, 1], 'create:mechanical_press', { facing: 'east' })
    const { result } = trace(fx, [port([1, 0, 1], 'west', 'minecraft:iron_ingot')], { '1,2,1': 256 })
    expect(at(result, '1,2,1')?.recipes[0]?.outputs[0]?.item).toBe('create:iron_sheet')
    expect(sinkOf(result, '1,1,2', 'create:iron_sheet')).toBe(1)
  })

  it('シュート：上から受け取って下へ。横からは受け取らない。斜めは pos.below().relative(facing の反対)。扇風機は仮定', () => {
    const fx = blueprintFixture()
      .place([1, 3, 0], 'create:chute', { facing: 'down' })
      .place([1, 2, 0], 'create:chute', { facing: 'east' })
      .place([0, 1, 0], 'minecraft:chest', chest)
      .place([1, 4, 0], 'create:encased_fan', { facing: 'down' })
    const { result, log } = trace(fx, [port([1, 3, 0], 'up', 'minecraft:stone'), port([1, 2, 0], 'north', 'minecraft:dirt')])
    expect(sinkOf(result, '0,1,0', 'minecraft:stone')).toBe(1)
    expect(at(result, '0,1,0')?.sinks[0]?.source).toBe('assumed')
    expect(messages(log)).toContain('シュートに扇風機がつながっているが、物は下へ流れるとした')
    expect(messages(log)).toContain('シュートは上からしか受け取らないので、物はここで止まる')
    expect(result.records.some((r) => r.arrivals.some((a) => a.item === 'minecraft:dirt'))).toBe(false)
  })

  it('粉砕ホイールの中心：タグのレシピで砕き、真下へ。横向きは扱わない', () => {
    const fx = blueprintFixture()
      .place([0, 1, 0], 'create:crushing_wheel', { axis: 'z' })
      .place([1, 1, 0], 'create:crushing_wheel_controller', { facing: 'down' })
      .place([2, 1, 0], 'create:crushing_wheel', { axis: 'z' })
      .place([1, 0, 0], 'minecraft:chest', chest)
      .place([1, 1, 2], 'create:crushing_wheel_controller', { facing: 'east' })
    const { result, log } = trace(
      fx,
      [port([1, 1, 0], 'up', 'minecraft:iron_ore', 2), port([1, 1, 2], 'up', 'minecraft:iron_ore')],
      { '0,1,0': 64, '2,1,0': -64 },
    )
    expect(at(result, '1,1,0')?.recipes[0]?.choice.recipe?.id).toBe('create:crushing/iron_ore')
    expect(sinkOf(result, '1,0,0', 'create:crushed_raw_iron')).toBe(2)
    expect(sinkOf(result, '1,0,0', 'create:experience_nugget')).toBe(1.5)
    expect(messages(log)).toContain('横向きの粉砕ホイール（ベルトの上の粉砕）は扱わないので、物はここで止まるとした')
  })

  it('ソー（上向き）：軸が Z なら回転数 > 0 で +X、軸が X なら回転数 > 0 で −Z へ', () => {
    const fx = blueprintFixture()
      .place([1, 0, 1], 'create:mechanical_saw', { facing: 'up', axis_along_first: 'false' })
      .place([2, 0, 1], 'minecraft:chest', chest)
      .place([0, 0, 1], 'minecraft:chest', chest)
      .place([1, 0, 4], 'create:mechanical_saw', { facing: 'up', axis_along_first: 'true' })
      .place([1, 0, 3], 'minecraft:chest', chest)
    const { result } = trace(
      fx,
      [port([1, 0, 1], 'up', 'minecraft:oak_log'), port([1, 0, 4], 'up', 'minecraft:oak_log')],
      { '1,0,1': 32, '1,0,4': 32 },
    )
    expect(sinkOf(result, '2,0,1', 'minecraft:stripped_oak_log')).toBe(1)
    expect(at(result, '0,0,1')).toBeUndefined()
    expect(sinkOf(result, '1,0,3', 'minecraft:stripped_oak_log')).toBe(1)
    const reverse = trace(fx, [port([1, 0, 1], 'up', 'minecraft:oak_log')], { '1,0,1': -32 }).result
    expect(sinkOf(reverse, '0,0,1', 'minecraft:stripped_oak_log')).toBe(1)
  })

  it('ベイスン：ミキサーで混ぜて facing の先の下へ。ほかの材料は仮定。プレスなら圧縮、facing=down は取り出すファンネルへ', () => {
    const fx = blueprintFixture()
      .place([0, 1, 0], 'create:basin', { facing: 'east' })
      .place([0, 3, 0], 'create:mechanical_mixer')
      .place([1, 0, 0], 'create:depot')
      .place([3, 1, 0], 'create:basin', { facing: 'down' })
      .place([3, 3, 0], 'create:mechanical_press', { facing: 'north' })
      .place([4, 1, 0], 'create:andesite_funnel', { facing: 'east', extracting: 'true', powered: 'false' })
      .place([5, 1, 0], 'minecraft:chest', chest)
    const { result, log } = trace(
      fx,
      // ミキサーは 256 RPM で1分に 21 回なので、入る数はそれより少なくする
      [port([0, 1, 0], 'up', 'minecraft:andesite', 0.25), port([3, 1, 0], 'up', 'minecraft:flint')],
      { '0,3,0': 256, '3,3,0': 256 },
    )
    expect(sinkOf(result, '1,0,0', 'create:andesite_alloy')).toBe(0.25)
    expect(messages(log)).toContain('レシピ create:mixing/andesite_alloy のほかの材料は、あるものとした')
    expect(at(result, '3,1,0')?.recipes[0]?.type).toBe('compacting')
    expect(rateOf(result, '4,1,0', 'minecraft:granite')).toBe(1)
    expect(sinkOf(result, '5,1,0', 'minecraft:granite')).toBe(1)
  })

  it('ファンネル：入れるファンネルは口の前からだけ受け取り、後ろの入れ物へ。取り出すファンネルの先が空気なら落ちる', () => {
    const fx = blueprintFixture({ size: [4, 3, 3] })
      .place([1, 0, 0], 'minecraft:chest', chest)
      .place([1, 0, 1], 'create:brass_funnel', { facing: 'south', extracting: 'false', powered: 'false' })
      .place([2, 0, 0], 'create:andesite_funnel', { facing: 'east', extracting: 'true', powered: 'false' })
      .place([3, 0, 0], 'create:depot')
      .place([3, 2, 0], 'minecraft:chest', chest)
      .place([3, 2, 1], 'create:andesite_funnel', { facing: 'south', extracting: 'true', powered: 'false' })
    const { result, log } = trace(fx, [port([1, 0, 1], 'south', 'minecraft:stone'), port([1, 0, 1], 'east', 'minecraft:dirt')])
    // ファンネル → 後ろの入れ物 (1,0,0) → 取り出すファンネル (2,0,0) → 口の前のデポ
    expect(rateOf(result, '1,0,0', 'minecraft:stone')).toBe(1)
    expect(sinkOf(result, '3,0,0', 'minecraft:stone')).toBe(1)
    expect(messages(log)).toContain('ファンネルは口の前からしか受け取らないので、物はここで止まる')

    const fall = trace(fx, [port([3, 2, 0], 'up', 'minecraft:stone')])
    expect(sinkOf(fall.result, '3,0,0', 'minecraft:stone')).toBe(0)
    expect(messages(fall.log)).toContain('出す先（(3, 2, 2)）が空気で、3 段下までにブロックがないので、その先はたどらない')
  })

  it('機械アーム：TAKE の点から、すべての DEPOSIT の点へ等しく分ける', () => {
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
    const { result } = trace(fx, [port([0, 0, 0], 'up', 'minecraft:stone', 3)], { '1,0,0': 64 })
    expect(rateOf(result, '1,0,0', 'minecraft:stone')).toBe(3)
    expect(sinkOf(result, '2,0,0', 'minecraft:stone')).toBe(1.5)
    expect(sinkOf(result, '1,0,1', 'minecraft:stone')).toBe(1.5)

    // 止まっていれば運ばず、取る先に溜まる
    const stopped = trace(fx, [port([0, 0, 0], 'up', 'minecraft:stone', 3)], { '1,0,0': 0 }).result
    expect(sinkOf(stopped, '0,0,0', 'minecraft:stone')).toBe(3)
    expect(at(stopped, '1,0,0')?.notes).toContain('止まっているので、物を運ばない')
  })

  it('輪になった通り道は、同じ物が2回目に届いた所で止める', () => {
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
    const { result, log } = trace(fx, [port([0, 0, 0], 'up', 'minecraft:stone')], { '1,0,0': 64, '1,1,0': 64 })
    expect(messages(log)).toContain('物の通り道が輪になっているので、同じ物が2回目に届いた所から先はたどらない')
    expect(rateOf(result, '2,0,0', 'minecraft:stone')).toBe(1)
  })

  it('処理できる数を超えたら「処理が追いつかない」。レシピのない物はそこで止める', () => {
    const fx = blueprintFixture().place([0, 0, 0], 'create:millstone').place([2, 0, 0], 'create:millstone')
    // 16 RPM で小麦（処理時間 150）は 150 tick で1個 → 8 個/分。1 個/秒 = 60 個/分は多すぎる
    const { result } = trace(fx, [port([0, 0, 0], 'up', 'minecraft:wheat'), port([2, 0, 0], 'up', 'minecraft:stone')], {
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

  it('Modpack のレシピがなければ、レシピがないのではなく分からないと出す', () => {
    const fx = blueprintFixture().place([0, 0, 0], 'create:millstone')
    const { result } = trace(fx, [port([0, 0, 0], 'up', 'minecraft:wheat')], { '0,0,0': 16 }, null)
    expect(at(result, '0,0,0')?.recipesUnknown).toBe(true)
    expect(itemPathValues(at(result, '0,0,0')!).find((v) => v.label === 'レシピ')?.value.value).toBe(
      'Modpack を読んでいないので、レシピが分からない（minecraft:wheat）。上のバーで Modpack を選ぶと、できる物をたどる',
    )
  })

  it('アイテムを選んでいない物の入口は、仮定に載せてたどらない。Modpack がなければ機械で止まる', () => {
    const fx = blueprintFixture().place([0, 0, 0], 'create:millstone')
    const { result, log } = trace(fx, [port([0, 0, 0], 'up', null)], { '0,0,0': 16 })
    expect(result.records).toEqual([])
    expect(messages(log)).toEqual(['物の入口のアイテムが選ばれていない'])
    const none = trace(fx, [port([0, 0, 0], 'up', 'minecraft:wheat')], { '0,0,0': 16 }, null)
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
    return trace(fx, [port([1, 3, 0], 'up', 'minecraft:wheat', 1)], { '1,3,0': millRpm, '1,1,0': -32, '2,1,0': -32 }).result
  }

  it('256 RPM：石臼は 120 個/分。使用率 50%、出る数 105 個/分、入る数は 120 個/分まで増やせる', () => {
    const result = line(256)
    expect(result.line).toEqual({
      inputPerMinute: 60,
      outputPerMinute: 105,
      bottleneck: { pos: [1, 3, 0], machine: '石臼', arrivingPerMinute: 60, capacityPerMinute: 120, utilization: 0.5 },
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

  it('16 RPM：石臼は 8 個/分。使用率 750% で追いつかず、出る数は 14 個/分。増やせる数は出さない', () => {
    const result = line(16)
    expect(result.line?.bottleneck?.utilization).toBe(7.5)
    expect(result.line?.outputPerMinute).toBeCloseTo(14)
    expect(lineSummary(result.line!).value.value).toBe('入る 60 個/分 → 律速 石臼 8 個/分のうち 60 個/分（750%、追いつかない） → 出る 14 個/分')
    expect(bottleneckValue(result.line!)?.value.value).toBe('生産ラインで一番忙しい機械。使用率 750%（追いつかない）')
  })

  it('使用率が一番高い機械を律速にする。同じなら先にたどった方', () => {
    // 2つの石臼に別々の入口。256 RPM（120 個/分）に 60 個/分、64 RPM（⌈150 / 4⌉ = 38 tick、32 個/分）に 30 個/分
    const fx = blueprintFixture().place([0, 0, 0], 'create:millstone').place([2, 0, 0], 'create:millstone')
    const busy = trace(fx, [port([0, 0, 0], 'up', 'minecraft:wheat', 1), port([2, 0, 0], 'up', 'minecraft:wheat', 0.5)], {
      '0,0,0': 256,
      '2,0,0': 64,
    }).result
    expect(busy.line?.inputPerMinute).toBe(90)
    expect(busy.line?.bottleneck?.pos).toEqual([2, 0, 0])
    const tie = trace(fx, [port([2, 0, 0], 'up', 'minecraft:wheat', 1), port([0, 0, 0], 'up', 'minecraft:wheat', 1)], {
      '0,0,0': 256,
      '2,0,0': 256,
    }).result
    expect(tie.line?.bottleneck?.pos).toEqual([2, 0, 0])
  })

  it('処理する機械がなければ、律速を出さずに入る数と出る数だけ。入口がなければ null', () => {
    const fx = blueprintFixture().place([0, 0, 0], 'create:depot')
    const result = trace(fx, [port([0, 0, 0], 'up', 'minecraft:wheat', 1)]).result
    expect(result.line?.bottleneck).toBeNull()
    expect(lineSummary(result.line!).value.value).toBe('入る 60 個/分 → 出る 60 個/分。処理する機械がない')
    expect(lineSummary(result.line!).pos).toBeUndefined()
    expect(trace(fx, []).result.line).toBeNull()
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

  it('届く物・レシピ・溜まる物をプローブに出し、処理時間は通り道のレシピで計算する', async () => {
    const result = await runCreateStress(bp(), { pack, ports: [port([0, 1, 0], 'up', 'minecraft:wheat', 0.5)] })
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

  it('処理が追いつかないと計算の問題に出す。アイテムのない入口は仮定に載せる', async () => {
    const result = await runCreateStress(bp(), {
      pack,
      ports: [port([0, 1, 0], 'up', 'minecraft:wheat', 1), port([2, 0, 0], 'up', null)],
    })
    expect(result.issues.map((i) => i.message)).toContain(
      '処理が追いつきません。届く数は 60 個/分、処理できるのは 32 個/分です。入る数を減らすか、回転数を上げてください。',
    )
    expect(result.assumptions).toContainEqual({ pos: [2, 0, 0], message: '物の入口のアイテムが選ばれていない' })
  })
})
