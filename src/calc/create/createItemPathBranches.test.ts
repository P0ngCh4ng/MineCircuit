// 物の通り道（createItemPath.ts）の分岐を通すテスト（docs/create-verification.md「4. コードの分岐」）。
// 通常の動きは createItemPath.test.ts。ここでは、そこで通らない分かれ道を、ゲームで作れる置き方で通す。
import { describe, expect, it } from 'vitest'
import { blueprintFixture, type BlueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { nbt, type NbtCompound } from '../../domain/nbt'
import type { Vec3 } from '../../domain/vec3'
import type { ProcessingRecipe, RecipeBook, RecipeResult } from '../../io/modpack/recipes'
import { AssumptionLog } from '../assumptionLog'
import type { VirtualPort } from '../virtualPort'
import { itemPathValues, MAX_PATH_STEPS, traceItemPaths, type ItemPathResult } from './createItemPath'
import { recipeTypeId, type CreateRecipeKind } from './createRecipeTypes'
import { deployerCycleTicks } from './createThroughput'

const recipe = (id: string, type: CreateRecipeKind, items: string[], duration: number, results: RecipeResult[]): ProcessingRecipe => ({
  id,
  type: recipeTypeId(type),
  items,
  tags: [],
  duration,
  results,
})
const out = (item: string, count = 1, chance = 1): RecipeResult => ({ item, count, chance })

const BOOK: RecipeBook = {
  recipes: [
    recipe('create:pressing/iron_ingot', 'pressing', ['minecraft:iron_ingot'], 0, [out('create:iron_sheet')]),
    recipe('create:splashing/gravel', 'splashing', ['minecraft:gravel'], 0, [out('minecraft:flint', 1, 0.25), out('minecraft:iron_nugget', 1, 0.125)]),
  ],
  scriptsChangeRecipes: false,
  itemTags: {},
}

const chest = nbt.compound({ Items: nbt.list('compound') })
const stack = (id: string) => nbt.compound({ id: nbt.string(id), Count: nbt.byte(1) })
/** 真鍮のトンネルの生データ。side の面（Minecraft の 3D の番号。4 西・5 東）のフィルター */
const tunnelFilter = (side: number, item: string) =>
  nbt.compound({
    Filters: nbt.list('compound', [nbt.compound({ Side: nbt.int(side), Filter: stack(item), FilterAmount: nbt.int(64) })]),
  })

let portCount = 0
const port = (pos: Vec3, item: string, rate = 1): VirtualPort => ({
  id: `p${++portCount}`,
  pos,
  pluginId: 'create-stress',
  kind: 'item-input',
  params: { rate },
  items: { item },
})

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
const moveOf = (r: ItemPathResult, from: string, to: string, item: string) =>
  r.moves.find((m) => m.from.join(',') === from && m.to.join(',') === to && m.item === item)

/** 水平のベルト（facing の向きに start → end） */
function belt(fx: BlueprintFixture, y: number, z: number, xs: number[], facing: 'east' | 'west'): BlueprintFixture {
  xs.forEach((x, i) => {
    const part = i === 0 ? 'start' : i === xs.length - 1 ? 'end' : 'middle'
    fx.place([x, y, z], 'create:belt', { facing, slope: 'horizontal', part })
  })
  return fx
}

const allAt = (positions: Vec3[], rpm: number) => Object.fromEntries(positions.map((p) => [p.join(','), rpm]))

const STOP_AT_TUNNEL = '次の区間の真鍮のトンネルのフィルターに合わないので、物はここで止まる'

describe('物の入口と、たどる長さ', () => {
  it('入る数のない物の入口はたどらない', () => {
    const fx = blueprintFixture().place([0, 0, 0], 'minecraft:chest', chest)
    const noRate: VirtualPort = { ...port([0, 0, 0], 'minecraft:stone'), params: {} }
    const { result, log } = trace(fx, [noRate])
    expect(result.records).toEqual([])
    expect(result.line).toBeNull()
    expect(messages(log)).toEqual([])
  })

  it('届かないほど少ない数は、どこにも届かない', () => {
    const fx = blueprintFixture().place([0, 0, 0], 'minecraft:chest', chest)
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:stone', 1e-12)])
    expect(result.records).toEqual([])
  })

  it('通り道が上限の数より長ければ、そこでたどるのをやめて仮定に載せる', () => {
    const n = MAX_PATH_STEPS + 4
    const fx = blueprintFixture({ size: [n + 1, 1, 1] })
    for (let x = 0; x < n; x++) fx.place([x, 0, 0], 'minecraft:hopper', { facing: 'east', enabled: 'true' })
    fx.place([n, 0, 0], 'minecraft:chest', chest)
    const { result, log } = trace(fx, [port([0, 0, 0], 'minecraft:stone', 1)])
    expect(messages(log)).toContain(`物の通り道が長いので、${MAX_PATH_STEPS} か所でたどるのをやめた`)
    expect(rateOf(result, `${MAX_PATH_STEPS - 1},0,0`, 'minecraft:stone')).toBe(1)
    expect(at(result, `${MAX_PATH_STEPS},0,0`)).toBeUndefined()
    expect(at(result, `${n},0,0`)).toBeUndefined()
  })
})

describe('ベルトの上で変わった物と、次の区間の真鍮のトンネル', () => {
  it('風の中で変わった物が、次の区間のトンネルのフィルターに合わなければ、変わった区間で止まる', () => {
    // 東向きの扇風機 (0,1,0) の前に水 (1,1,0)。1段下に東へ進むベルト x = 2..9。x = 7 で洗い終わる（区間1つ 30 tick）
    // x = 8 の上の真鍮のトンネルは、入る側（西）で砂利だけを通す
    const fx = blueprintFixture({ size: [11, 2, 1] })
      .place([0, 1, 0], 'create:encased_fan', { facing: 'east' })
      .place([1, 1, 0], 'minecraft:water', { level: '0' })
      .place([8, 1, 0], 'create:brass_tunnel', { axis: 'x', shape: 'straight' }, tunnelFilter(4, 'minecraft:gravel'))
      .place([10, 0, 0], 'minecraft:chest', chest)
    belt(fx, 0, 0, [2, 3, 4, 5, 6, 7, 8, 9], 'east')
    const speeds: Record<string, number> = { '0,1,0': 256 }
    for (let x = 2; x <= 9; x++) speeds[`${x},0,0`] = -16
    const { result } = trace(fx, [port([2, 0, 0], 'minecraft:gravel')], speeds)
    expect(at(result, '7,0,0')?.recipes[0]).toMatchObject({ type: 'splashing', input: 'minecraft:gravel' })
    expect(at(result, '7,0,0')?.notes).toContain(STOP_AT_TUNNEL)
    expect(at(result, '8,0,0')).toBeUndefined()
    expect(at(result, '10,0,0')).toBeUndefined()
  })

  /** 東へ進むベルト x = 0..2、(1,2,0) にプレス、端の先にチェスト (3,0,0) */
  const pressLine = () =>
    belt(blueprintFixture({ size: [4, 3, 1] }), 0, 0, [0, 1, 2], 'east')
      .place([1, 2, 0], 'create:mechanical_press', { facing: 'north' })
      .place([3, 0, 0], 'minecraft:chest', chest)
  const pressSpeeds = { '0,0,0': -32, '1,0,0': -32, '2,0,0': -32, '1,2,0': 64 }

  it('ベルトの上のプレスにレシピのない物が届いたら、そこで止まる', () => {
    const { result } = trace(pressLine(), [port([0, 0, 0], 'minecraft:stone')], pressSpeeds)
    expect(at(result, '1,2,0')?.noRecipe).toEqual(['minecraft:stone'])
    expect(at(result, '2,0,0')).toBeUndefined()
    expect(at(result, '3,0,0')).toBeUndefined()
  })

  it('プレスで変わった物が、次の区間のトンネルのフィルターに合わなければ、プレスの下で止まる', () => {
    const fx = pressLine().place([2, 1, 0], 'create:brass_tunnel', { axis: 'x', shape: 'straight' }, tunnelFilter(4, 'minecraft:iron_ingot'))
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:iron_ingot')], pressSpeeds)
    expect(at(result, '1,2,0')?.recipes[0]?.outputs[0]?.item).toBe('create:iron_sheet')
    expect(at(result, '1,0,0')?.notes).toContain(STOP_AT_TUNNEL)
    expect(at(result, '3,0,0')).toBeUndefined()
  })
})

describe('真鍮のトンネルの組', () => {
  /** 東へ進む2本のベルト z = 1, 2（x = 0..2）。それぞれの上 (1,1,z) に真鍮のトンネル、端の先にチェスト */
  const pair = (neighbor: NbtCompound | undefined) => {
    const f = blueprintFixture({ size: [4, 2, 3] })
    belt(f, 0, 1, [0, 1, 2], 'east')
    belt(f, 0, 2, [0, 1, 2], 'east')
    return f
      .place([3, 0, 1], 'minecraft:chest', chest)
      .place([3, 0, 2], 'minecraft:chest', chest)
      .place([1, 1, 1], 'create:brass_tunnel')
      .place([1, 1, 2], 'create:brass_tunnel', {}, neighbor)
  }
  const pairSpeeds = { '0,0,1': -24, '1,0,1': -24, '2,0,1': -24, '0,0,2': -24, '1,0,2': -24, '2,0,2': -24 }

  it('組のほかのトンネルの先の出口が、そのフィルターに合わなければ、そこへは分けない', () => {
    const open = trace(pair(undefined), [port([0, 0, 1], 'minecraft:stone')], pairSpeeds).result
    expect(sinkOf(open, '3,0,2', 'minecraft:stone')).toBe(0.5)
    const filtered = trace(pair(tunnelFilter(5, 'minecraft:dirt')), [port([0, 0, 1], 'minecraft:stone')], pairSpeeds).result
    expect(sinkOf(filtered, '3,0,1', 'minecraft:stone')).toBe(1)
    expect(sinkOf(filtered, '3,0,2', 'minecraft:stone')).toBe(0)
  })

  it('ベルトの軸の口しかなくても、横のトンネルとつながっていれば分ける', () => {
    const tunnel = (connected: number) =>
      nbt.compound({
        Flaps: nbt.list('int', [nbt.int(4), nbt.int(5)]),
        Sides: nbt.list('int', [nbt.int(2), nbt.int(4), nbt.int(5)]),
        ConnectedLeft: nbt.byte(connected),
        ConnectedRight: nbt.byte(0),
      })
    const fx = (be: NbtCompound) =>
      belt(blueprintFixture({ size: [4, 2, 3] }), 0, 1, [0, 1, 2], 'east')
        .place([1, 1, 1], 'create:brass_tunnel', { axis: 'x', shape: 'straight' }, be)
        .place([1, 0, 0], 'create:depot')
        .place([3, 0, 1], 'minecraft:chest', chest)
    const speeds = { '0,0,1': -24, '1,0,1': -24, '2,0,1': -24 }
    const alone = trace(fx(tunnel(0)), [port([0, 0, 1], 'minecraft:stone')], speeds).result
    expect(sinkOf(alone, '3,0,1', 'minecraft:stone')).toBe(1)
    expect(sinkOf(alone, '1,0,0', 'minecraft:stone')).toBe(0)
    const connected = trace(fx(tunnel(1)), [port([0, 0, 1], 'minecraft:stone')], speeds).result
    expect(sinkOf(connected, '3,0,1', 'minecraft:stone')).toBe(0.5)
    expect(sinkOf(connected, '1,0,0', 'minecraft:stone')).toBe(0.5)
  })

  it('横のベルトが直角に走っていれば、組には入れず、端の横の口として分ける', () => {
    // 東へ進むベルト z = 2 の上 (1,1,2) にトンネル。北隣 (1,0,1) は南北のベルト（北へ進む）で、その上にもトンネル。北の端の先にチェスト (1,0,0)
    const fx = belt(blueprintFixture({ size: [4, 2, 4] }), 0, 2, [0, 1, 2], 'east')
      .place([1, 1, 2], 'create:brass_tunnel')
      .place([1, 0, 1], 'create:belt', { facing: 'south', slope: 'horizontal', part: 'start' })
      .place([1, 1, 1], 'create:brass_tunnel')
      .place([1, 0, 0], 'minecraft:chest', chest)
      .place([3, 0, 2], 'minecraft:chest', chest)
    const speeds = { '0,0,2': -24, '1,0,2': -24, '2,0,2': -24, '1,0,1': -24 }
    const { result } = trace(fx, [port([0, 0, 2], 'minecraft:stone')], speeds)
    expect(sinkOf(result, '3,0,2', 'minecraft:stone')).toBe(0.5)
    expect(rateOf(result, '1,0,1', 'minecraft:stone')).toBe(0.5)
    expect(sinkOf(result, '1,0,0', 'minecraft:stone')).toBe(0.5)
  })

  it('組のほかのトンネルの先が空気なら、下に落ちる。落ちる動きはトンネルの区間から始まる', () => {
    // ベルトは y = 1。北のベルト z = 1 は x = 0..2、南のベルト z = 2 は x = 0..1 で、(1,2,2) のトンネルの先 (2,1,2) は空気
    const f = blueprintFixture({ size: [4, 3, 3] })
    belt(f, 1, 1, [0, 1, 2], 'east')
    belt(f, 1, 2, [0, 1], 'east')
    f.place([1, 2, 1], 'create:brass_tunnel')
      .place([1, 2, 2], 'create:brass_tunnel')
      .place([3, 1, 1], 'minecraft:chest', chest)
      .place([2, 0, 2], 'minecraft:chest', chest)
    const speeds = { '0,1,1': -24, '1,1,1': -24, '2,1,1': -24, '0,1,2': -24, '1,1,2': -24 }
    const { result, log } = trace(f, [port([0, 1, 1], 'minecraft:stone')], speeds)
    expect(sinkOf(result, '3,1,1', 'minecraft:stone')).toBe(0.5)
    expect(sinkOf(result, '2,0,2', 'minecraft:stone')).toBe(0.5)
    expect(messages(log)).toContain('出す先（(2, 1, 2)）が空気なので、物は下の (2, 0, 2) に落ちるとした')
    const fall = moveOf(result, '1,1,1', '2,0,2', 'minecraft:stone')!
    expect(fall.path![0]!.pos).toEqual([1.5, 1.5, 1.5])
    expect(fall.path![fall.path!.length - 1]!.pos).toEqual([2.5, 0.5, 2.5])
  })

  it('南北に進むベルトの安山岩のトンネルも、横（東西）に口があれば仮定に載せて素通りする', () => {
    const fx = blueprintFixture({ size: [2, 2, 4] })
      .place([1, 0, 0], 'create:belt', { facing: 'south', slope: 'horizontal', part: 'start' })
      .place([1, 0, 1], 'create:belt', { facing: 'south', slope: 'horizontal', part: 'middle' })
      .place([1, 0, 2], 'create:belt', { facing: 'south', slope: 'horizontal', part: 'end' })
      .place([1, 1, 1], 'create:andesite_tunnel')
      .place([0, 0, 1], 'create:depot')
      .place([1, 0, 3], 'minecraft:chest', chest)
    const { result, log } = trace(fx, [port([1, 0, 0], 'minecraft:stone')], { '1,0,0': 32, '1,0,1': 32, '1,0,2': 32 })
    expect(sinkOf(result, '1,0,3', 'minecraft:stone')).toBe(1)
    expect(at(result, '0,0,1')).toBeUndefined()
    expect(messages(log)).toContain('物は1個ずつ流れるとしたので、安山岩のトンネルは横へ分けずに素通りする')
  })
})

describe('メカニカルクラフター', () => {
  const ing = (items: string[]) => ({ items, tags: [] })
  const pair = (id: string): ProcessingRecipe => ({
    ...recipe(id, 'mechanical_crafting', [], 0, [out('test:pair')]),
    grid: { rows: [[ing(['create:andesite_alloy']), ing(['minecraft:iron_ingot'])]], ingredients: [], mirrored: false },
  })
  const CRAFT_BOOK: RecipeBook = { ...BOOK, recipes: [...BOOK.recipes, pair('create:mechanical_crafting/pair')] }
  const crafter = (facing: string, pointing: string) => ({ facing, pointing, waterlogged: 'false' })
  /** 南向き（右は東）：(0,1,0)→(1,1,0)↓ チェスト (1,0,0)。並びは 左 (0,1,0)、右 (1,1,0) */
  const fx = () =>
    blueprintFixture({ size: [2, 2, 1] })
      .place([0, 1, 0], 'create:mechanical_crafter', crafter('south', 'right'))
      .place([1, 1, 0], 'create:mechanical_crafter', crafter('south', 'down'))
      .place([1, 0, 0], 'minecraft:chest', chest)
  const speeds = allAt([[0, 1, 0], [1, 1, 0]], 64)

  it('同じクラフターに同じ物が2つの入口から届けば、数を足して使う', () => {
    const ports = [port([0, 1, 0], 'create:andesite_alloy', 0.05), port([0, 1, 0], 'create:andesite_alloy', 0.05), port([1, 1, 0], 'minecraft:iron_ingot')]
    const { result } = trace(fx(), ports, speeds, CRAFT_BOOK)
    expect(rateOf(result, '0,1,0', 'create:andesite_alloy')).toBeCloseTo(0.1)
    expect(sinkOf(result, '1,0,0', 'test:pair')).toBeCloseTo(0.1)
  })

  it('スクリプトがレシピを変えていれば、仮定に載せる', () => {
    const ports = [port([0, 1, 0], 'create:andesite_alloy', 0.1), port([1, 1, 0], 'minecraft:iron_ingot', 0.1)]
    const { result, log } = trace(fx(), ports, speeds, { ...CRAFT_BOOK, scriptsChangeRecipes: true })
    expect(sinkOf(result, '1,0,0', 'test:pair')).toBeCloseTo(0.1)
    expect(messages(log)).toContain('KubeJS のスクリプトがレシピを変えているが、スクリプトのレシピは読めないので、物の通り道に入れていない')
  })

  it('並びに合うレシピが2つ以上なら、ID の名前順で最初のものを使い、仮定に載せる', () => {
    const book: RecipeBook = { ...CRAFT_BOOK, recipes: [...CRAFT_BOOK.recipes, pair('create:mechanical_crafting/pair_b')] }
    const ports = [port([0, 1, 0], 'create:andesite_alloy', 0.1), port([1, 1, 0], 'minecraft:iron_ingot', 0.1)]
    const { result, log } = trace(fx(), ports, speeds, book)
    expect(at(result, '1,1,0')?.recipes[0]?.choice.recipe?.id).toBe('create:mechanical_crafting/pair')
    expect(messages(log)).toContain(
      'メカニカルクラフターの材料の並びに合うレシピが 2 つあるので、ID の名前順で最初の create:mechanical_crafting/pair を使った',
    )
  })

  it('組み立てたあとに、できた物が同じ組に戻ってきても、組み立てには入れない', () => {
    // 1台のクラフター (0,1,0) は下のチェスト (0,0,0) へ出す。機械アーム (1,0,0) がチェストから取ってクラフターへ戻す
    const planks: ProcessingRecipe = {
      ...recipe('test:planks', 'crafting_shapeless', [], 0, [out('minecraft:oak_planks')]),
      grid: { rows: null, ingredients: [ing(['minecraft:oak_log'])], mirrored: true },
    }
    const points = nbt.list('compound', [
      nbt.compound({ Pos: nbt.intArray([-1, 0, 0]), Mode: nbt.string('TAKE') }),
      nbt.compound({ Pos: nbt.intArray([-1, 1, 0]), Mode: nbt.string('DEPOSIT') }),
    ])
    const loop = blueprintFixture({ size: [2, 2, 1] })
      .place([0, 1, 0], 'create:mechanical_crafter', crafter('south', 'down'))
      .place([0, 0, 0], 'minecraft:chest', chest)
      .place([1, 0, 0], 'create:mechanical_arm', nbt.compound({ InteractionPoints: points }))
    const { result, log } = trace(loop, [port([0, 1, 0], 'minecraft:oak_log', 0.1)], { '0,1,0': 64, '1,0,0': 64 }, { ...BOOK, recipes: [planks] })
    expect(at(result, '0,1,0')?.recipes[0]?.outputs).toEqual([{ item: 'minecraft:oak_planks', rate: 0.1, source: 'virtual' }])
    expect(rateOf(result, '0,1,0', 'minecraft:oak_planks')).toBeCloseTo(0.1)
    expect(messages(log)).toContain('クラフターの組を組み立てたあとに届いた物は、組み立てに入れていない')
  })
})

describe('レシピのない物と、2回届く物', () => {
  it('粉砕ホイール・ベイスンにレシピのない物が届いたら、そこで止まる', () => {
    const fx = blueprintFixture({ size: [6, 4, 1] })
      .place([0, 1, 0], 'create:crushing_wheel', { axis: 'z' })
      .place([1, 1, 0], 'create:crushing_wheel_controller', { facing: 'down' })
      .place([2, 1, 0], 'create:crushing_wheel', { axis: 'z' })
      .place([1, 0, 0], 'minecraft:chest', chest)
      .place([4, 1, 0], 'create:basin', { facing: 'east' })
      .place([4, 3, 0], 'create:mechanical_mixer')
      .place([5, 0, 0], 'create:depot')
    const { result } = trace(
      fx,
      [port([1, 1, 0], 'minecraft:stone'), port([4, 1, 0], 'minecraft:stone')],
      { '0,1,0': 64, '2,1,0': -64, '4,3,0': 64 },
    )
    expect(at(result, '1,1,0')?.noRecipe).toEqual(['minecraft:stone'])
    expect(at(result, '1,0,0')).toBeUndefined()
    expect(at(result, '4,1,0')?.noRecipe).toEqual(['minecraft:stone'])
    expect(at(result, '5,0,0')).toBeUndefined()
  })

  it('同じ機械に、レシピのない同じ物が2回届いても、レシピのない物は1つ', () => {
    const fx = blueprintFixture().place([0, 0, 0], 'create:millstone')
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:stone'), port([0, 0, 0], 'minecraft:stone')], { '0,0,0': 64 })
    expect(at(result, '0,0,0')?.noRecipe).toEqual(['minecraft:stone'])
    expect(rateOf(result, '0,0,0', 'minecraft:stone')).toBe(2)
  })

  it('機械アームがデポに置いた物も、上のプレスで押す', () => {
    const points = nbt.list('compound', [
      nbt.compound({ Pos: nbt.intArray([-1, 0, 0]), Mode: nbt.string('TAKE') }),
      nbt.compound({ Pos: nbt.intArray([1, 0, 0]), Mode: nbt.string('DEPOSIT') }),
    ])
    const fx = blueprintFixture({ size: [3, 3, 1] })
      .place([0, 0, 0], 'minecraft:chest', chest)
      .place([1, 0, 0], 'create:mechanical_arm', nbt.compound({ InteractionPoints: points }))
      .place([2, 0, 0], 'create:depot')
      .place([2, 2, 0], 'create:mechanical_press', { facing: 'north' })
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:iron_ingot', 0.5)], { '1,0,0': 64, '2,2,0': 64 })
    expect(rateOf(result, '2,2,0', 'minecraft:iron_ingot')).toBe(0.5)
    expect(sinkOf(result, '2,0,0', 'create:iron_sheet')).toBe(0.5)
    expect(moveOf(result, '0,0,0', '2,0,0', 'minecraft:iron_ingot')).toBeDefined()
  })
})

describe('デプロイヤー・ファンネル', () => {
  it('物の入口から直接デプロイヤーに入れた物は、デプロイヤーの所で1回の動作のあいだ止まる', () => {
    const fx = blueprintFixture({ size: [1, 3, 1] })
      .place([0, 0, 0], 'create:deployer', { facing: 'up', axis_along_first: 'false' }, nbt.compound({ Mode: nbt.string('USE') }))
      .place([0, 2, 0], 'create:blaze_burner', { blaze: 'smouldering', facing: 'east' })
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:coal')], { '0,0,0': 16 })
    expect(rateOf(result, '0,2,0', 'minecraft:coal')).toBe(1)
    expect(moveOf(result, '0,0,0', '0,0,0', 'minecraft:coal')).toMatchObject({ seconds: 0, hold: deployerCycleTicks(16)! / 20 })
  })

  it('押し出す形のベルトのファンネルは、後ろの入れ物から取り出して真下のベルトに置く', () => {
    // 西へ進むベルト x = 2..1 の (2,1,0) に西向きのベルトのファンネル、後ろ (3,1,0) に樽。端の先にチェスト (0,0,0)
    const fx = belt(blueprintFixture({ size: [4, 2, 1] }), 0, 0, [2, 1], 'west')
      .place([3, 1, 0], 'minecraft:barrel', { facing: 'up' }, chest)
      .place([2, 1, 0], 'create:andesite_belt_funnel', { facing: 'west', shape: 'pushing', powered: 'false' })
      .place([0, 0, 0], 'minecraft:chest', chest)
    const { result } = trace(fx, [port([3, 1, 0], 'minecraft:coal')], { '2,0,0': 16, '1,0,0': 16 })
    expect(sinkOf(result, '3,1,0', 'minecraft:coal')).toBe(0)
    expect(rateOf(result, '2,0,0', 'minecraft:coal')).toBe(1)
    expect(sinkOf(result, '0,0,0', 'minecraft:coal')).toBe(1)
  })

  it('平行の形のベルトのファンネルは、下のベルトが止まっていれば押し出さない', () => {
    const fx = belt(blueprintFixture(), 0, 0, [2, 1, 0], 'west')
      .place([2, 1, 0], 'minecraft:barrel', { facing: 'up' }, chest)
      .place([1, 1, 0], 'create:andesite_belt_funnel', { facing: 'west', shape: 'retracted', powered: 'false' })
    const { result } = trace(fx, [port([2, 1, 0], 'minecraft:coal')], { '0,0,0': 0, '1,0,0': 0, '2,0,0': 0 })
    expect(sinkOf(result, '2,1,0', 'minecraft:coal')).toBe(1)
    expect(at(result, '1,0,0')).toBeUndefined()
  })

  it('中身の読めないフィルターは、物を通すとして仮定に載せる', () => {
    const fx = blueprintFixture({ size: [1, 2, 2] })
      .place([0, 1, 0], 'minecraft:chest', chest)
      .place(
        [0, 1, 1],
        'create:brass_funnel',
        { facing: 'south', extracting: 'true', powered: 'false' },
        nbt.compound({ Filter: stack('create:attribute_filter'), FilterAmount: nbt.int(64) }),
      )
      .place([0, 0, 1], 'create:depot')
    const { result, log } = trace(fx, [port([0, 1, 0], 'minecraft:stone')])
    expect(sinkOf(result, '0,0,1', 'minecraft:stone')).toBe(1)
    expect(messages(log)).toContain('フィルター create:attribute_filter の中身は読めないので、物を通すとした')
  })

  it('上向きの取り出すファンネルは、口の前（上）に置く', () => {
    const fx = blueprintFixture({ size: [1, 3, 1] })
      .place([0, 0, 0], 'minecraft:chest', chest)
      .place([0, 1, 0], 'create:andesite_funnel', { facing: 'up', extracting: 'true', powered: 'false' })
      .place([0, 2, 0], 'create:depot')
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:stone')])
    expect(sinkOf(result, '0,0,0', 'minecraft:stone')).toBe(0)
    expect(rateOf(result, '0,1,0', 'minecraft:stone')).toBe(1)
    expect(sinkOf(result, '0,2,0', 'minecraft:stone')).toBe(1)
    expect(moveOf(result, '0,1,0', '0,2,0', 'minecraft:stone')?.seconds).toBe(0)
  })
})

describe('扇風機の処理', () => {
  /** 東向きの扇風機 (0,1,0) の前に水 (1,1,0)、1段下にデポ (2,0,0) */
  const depotInWind = () =>
    blueprintFixture({ size: [5, 2, 1] })
      .place([0, 1, 0], 'create:encased_fan', { facing: 'east' })
      .place([1, 1, 0], 'minecraft:water', { level: '0' })
      .place([2, 0, 0], 'create:depot')
  const fanSpeeds = { '0,1,0': 64 }

  it('ベルトの上でレシピのない物は、洗い終わる区間で変わらないと記録し、その先の同じ風では処理しない', () => {
    const fx = blueprintFixture({ size: [11, 2, 1] })
      .place([0, 1, 0], 'create:encased_fan', { facing: 'east' })
      .place([1, 1, 0], 'minecraft:water', { level: '0' })
      .place([10, 0, 0], 'minecraft:chest', chest)
    belt(fx, 0, 0, [2, 3, 4, 5, 6, 7, 8, 9], 'east')
    const speeds: Record<string, number> = { '0,1,0': 256 }
    for (let x = 2; x <= 9; x++) speeds[`${x},0,0`] = -16
    const { result } = trace(fx, [port([2, 0, 0], 'minecraft:stone')], speeds)
    expect(at(result, '7,0,0')?.notes).toContain('minecraft:stone を洗うレシピがないので、物は変わらない')
    expect(at(result, '8,0,0')?.notes ?? []).toEqual([])
    expect(at(result, '9,0,0')?.notes ?? []).toEqual([])
    expect(sinkOf(result, '10,0,0', 'minecraft:stone')).toBe(1)
  })

  it('スクリプトがレシピを変えていれば、仮定に載せる', () => {
    const { result, log } = trace(depotInWind(), [port([2, 0, 0], 'minecraft:gravel')], fanSpeeds, { ...BOOK, scriptsChangeRecipes: true })
    expect(sinkOf(result, '2,0,0', 'minecraft:flint')).toBe(0.25)
    expect(messages(log)).toContain('KubeJS のスクリプトがレシピを変えているが、スクリプトのレシピは読めないので、物の通り道に入れていない')
  })

  it('合うレシピが2つ以上なら、ID の名前順で最初のものを使い、仮定に載せる', () => {
    const book: RecipeBook = {
      ...BOOK,
      recipes: [...BOOK.recipes, recipe('create:splashing/z_gravel', 'splashing', ['minecraft:gravel'], 0, [out('minecraft:sand')])],
    }
    const { result, log } = trace(depotInWind(), [port([2, 0, 0], 'minecraft:gravel')], fanSpeeds, book)
    expect(at(result, '2,0,0')?.recipes[0]?.choice.recipe?.id).toBe('create:splashing/gravel')
    expect(sinkOf(result, '2,0,0', 'minecraft:sand')).toBe(0)
    expect(messages(log).some((m) => m.includes('合うレシピが 2 つあるので、ID の名前順で最初の create:splashing/gravel を使った'))).toBe(true)
  })

  it('同じ所で同じ物を2回処理したら、1つのレシピにまとめる', () => {
    const { result } = trace(depotInWind(), [port([2, 0, 0], 'minecraft:gravel'), port([2, 0, 0], 'minecraft:gravel')], fanSpeeds)
    expect(at(result, '2,0,0')?.recipes).toHaveLength(1)
    expect(at(result, '2,0,0')?.recipes[0]?.outputs).toEqual([
      { item: 'minecraft:flint', rate: 0.5, source: 'virtual' },
      { item: 'minecraft:iron_nugget', rate: 0.25, source: 'virtual' },
    ])
    expect(sinkOf(result, '2,0,0', 'minecraft:flint')).toBe(0.5)
  })
})

describe('プローブの値', () => {
  it('物が届かず、注記だけがある所（止まっている機械アーム）は、物の通り道だけを出す', () => {
    const points = nbt.list('compound', [
      nbt.compound({ Pos: nbt.intArray([-1, 0, 0]), Mode: nbt.string('TAKE') }),
      nbt.compound({ Pos: nbt.intArray([1, 0, 0]), Mode: nbt.string('DEPOSIT') }),
    ])
    const fx = blueprintFixture()
      .place([1, 0, 0], 'create:mechanical_arm', nbt.compound({ InteractionPoints: points }))
      .place([0, 0, 0], 'minecraft:chest', chest)
      .place([2, 0, 0], 'create:depot')
    const { result } = trace(fx, [port([0, 0, 0], 'minecraft:stone')])
    expect(itemPathValues(at(result, '1,0,0')!)).toEqual([
      { label: '物の通り道', value: { value: '止まっているので、物を運ばない', source: 'virtual' } },
    ])
  })
})
