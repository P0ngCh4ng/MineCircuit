import { describe, expect, it } from 'vitest'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { nbt } from '../../domain/nbt'
import type { ProcessingRecipe, RecipeBook } from '../../io/modpack/recipes'
import type { CalcModpack } from '../calcPlugin'
import {
  armRoundTripTicks,
  beltSpeed,
  chooseRecipe,
  crushingTicks,
  deployerCycleTicks,
  findItemIds,
  formatRate,
  funnelAmount,
  funnelItemsPerSecond,
  millstoneTicks,
  mixerCycleTicks,
  pressCycleTicks,
  sawTicks,
} from './createThroughput'
import { runCreateStress } from './createStressPlugin'

const recipe = (id: string, type: ProcessingRecipe['type'], items: string[], duration: number): ProcessingRecipe => ({
  id,
  type,
  items,
  tags: [],
  duration,
  results: [],
})

const BOOK: RecipeBook = {
  recipes: [
    recipe('create:milling/wheat', 'milling', ['minecraft:wheat'], 150),
    recipe('create:milling/bone', 'milling', ['minecraft:bone'], 50),
    recipe('create:milling/gravel', 'milling', ['minecraft:gravel'], 250),
    recipe('create:mixing/andesite_alloy', 'mixing', ['minecraft:andesite'], 0),
  ],
  scriptsChangeRecipes: false,
  itemTags: {},
}

/** 1.18 の形のアイテム（{id, Count}） */
const item = (id: string, count = 1) => nbt.compound({ id: nbt.string(id), Count: nbt.byte(count) })

describe('例の表（すべて 64 RPM、設定ファイルなし）', () => {
  it('ベルト：2.67 ブロック/秒。1個ずつ 2.67 個/秒、64 個ずつ 171 個/秒', () => {
    expect(beltSpeed(64)).toBeCloseTo(2.667, 3)
    expect(formatRate(beltSpeed(64))).toBe('2.67')
    expect(formatRate(beltSpeed(64) * 64)).toBe('171')
  })

  it('機械アーム：16 tick × 4 で1往復 3.2 秒。1個ずつ 0.31 個/秒', () => {
    const ticks = armRoundTripTicks(64)!
    expect(ticks).toBe(64)
    expect(ticks / 20).toBe(3.2)
    expect(formatRate(20 / ticks)).toBe('0.31')
    // 256 RPM より速くても 1 tick に 256 / 1024 まで
    expect(armRoundTripTicks(256)).toBe(16)
    expect(armRoundTripTicks(0)).toBeNull()
  })

  it('安山岩のファンネル：1 個 / 8 tick で 2.5 個/秒', () => {
    const amount = funnelAmount('andesite_funnel', null)
    expect(amount).toEqual({ value: 1, source: 'builtin' })
    expect(funnelItemsPerSecond(amount.value, 8)).toBe(2.5)
  })

  it('真鍮のファンネル：フィルターの数（FilterAmount）を使う', () => {
    expect(funnelAmount('brass_funnel', nbt.compound({ FilterAmount: nbt.int(16) }))).toEqual({ value: 16, source: 'blueprint' })
    expect(funnelAmount('brass_funnel', null)).toEqual({ value: 64, source: 'builtin' })
    expect(funnelItemsPerSecond(16, 8)).toBe(40)
  })

  it('プレス：30 tick（1.5 秒）で1個、40 個/分', () => {
    const ticks = pressCycleTicks(64)!
    expect(ticks).toBe(30)
    expect(1200 / ticks).toBe(40)
    expect(pressCycleTicks(0)).toBeNull()
  })

  it('ミキサー（処理時間なし）：46 + 40 = 86 tick（4.3 秒）で1回、14 回/分', () => {
    const ticks = mixerCycleTicks(64, 0)!
    expect(ticks).toBe(86)
    expect(formatRate(1200 / ticks)).toBe('14')
    // 処理時間 100 は r = 1 で同じ
    expect(mixerCycleTicks(64, 100)).toBe(86)
  })

  it('石臼（処理時間 100）：25 tick（1.25 秒）で1個、48 個/分', () => {
    const ticks = millstoneTicks(64, 100)!
    expect(ticks).toBe(25)
    expect(1200 / ticks).toBe(48)
    // ゲームで確かめる手順の小麦（処理時間 150）
    expect(millstoneTicks(64, 150)).toBe(38)
  })

  it('粉砕ホイール（処理時間 100、1個）：6 tick で1個', () => {
    expect(crushingTicks(64, 100, 1)).toBe(6)
    // 64 個：100 → 20 未満に 0.853 ずつ 94 tick、そのあと 5.12 ずつ 4 tick
    expect(crushingTicks(64, 100, 64)).toBe(98)
    expect(crushingTicks(0, 100, 1)).toBeNull()
  })

  it('ソー（処理時間 50、1個）：25 tick で1個', () => {
    expect(sawTicks(64, 50, 1)).toBe(25)
    // 64 個：50 × ⌊64 / 5⌋ = 600。595 を切るのに 224 tick、20 → 0 に 8 tick
    expect(sawTicks(64, 50, 64)).toBe(232)
  })

  it('デプロイヤー：8 + 8 + 4 = 20 tick（1 秒）で1回', () => {
    expect(deployerCycleTicks(64)).toBe(20)
    expect(deployerCycleTicks(0)).toBeNull()
  })
})

describe('どのレシピか', () => {
  it('生データの中のアイテム（1.18 の Count と 1.20.5 の count）を探す', () => {
    const be = nbt.compound({
      id: nbt.string('create:millstone'),
      InputInventory: nbt.compound({ Items: nbt.list('compound', [item('minecraft:wheat', 12)]) }),
      Other: nbt.compound({ item: nbt.compound({ id: nbt.string('minecraft:bone'), count: nbt.int(3) }) }),
      Empty: item('minecraft:air'),
    })
    expect(findItemIds(be)).toEqual(['minecraft:wheat', 'minecraft:bone'])
    expect(findItemIds(null)).toEqual([])
  })

  it('生データの物を材料に持つレシピを使う', () => {
    const choice = chooseRecipe('milling', ['minecraft:wheat'], BOOK)
    expect(choice.duration).toEqual({ value: 150, source: 'modpack', note: 'create:milling/wheat' })
    expect(choice.assumption).toBeNull()
    expect(choice.text).toContain('create:milling/wheat')
  })

  it('決まらなければ範囲を出し、初期値で計算して仮定に載せる', () => {
    const choice = chooseRecipe('milling', ['minecraft:stone'], BOOK)
    expect(choice.duration).toEqual({ value: 100, source: 'assumed' })
    expect(choice.assumption).toContain('50〜250 tick')
    expect(chooseRecipe('cutting', [], BOOK).duration.value).toBe(50)
    // ミキサーの処理時間なしは 100（r = 1）
    expect(chooseRecipe('mixing', ['minecraft:andesite'], BOOK).duration).toMatchObject({ value: 100, source: 'modpack' })
  })

  it('Modpack がなければ初期値だけ', () => {
    const choice = chooseRecipe('crushing', ['minecraft:wheat'], null)
    expect(choice.duration).toEqual({ value: 100, source: 'assumed' })
    expect(choice.assumption).not.toContain('Modpack')
  })
})

describe('プローブ（runCreateStress）', () => {
  const motor64 = nbt.compound({ ScrollValue: nbt.int(64) })
  const pack = (book: RecipeBook | null): CalcModpack => ({
    hasNamespace: (ns) => ns === 'create',
    config: async () => null,
    ...(book ? { recipeBook: async () => book } : {}),
  })
  const line = () =>
    blueprintFixture()
      .place([0, 0, 0], 'create:creative_motor', { facing: 'up' }, motor64)
      .place(
        [0, 1, 0],
        'create:millstone',
        nbt.compound({ InputInventory: nbt.compound({ Items: nbt.list('compound', [item('minecraft:wheat', 12)]) }) }),
      )
      .place([2, 0, 0], 'create:andesite_funnel', { facing: 'north' })
      .place([3, 0, 0], 'create:brass_funnel', { facing: 'north' }, nbt.compound({ FilterAmount: nbt.int(8) }))
      .place([4, 1, 0], 'create:chute')
      .place([4, 0, 0], 'create:encased_fan', { facing: 'up' })
      .toBlueprint()
  const value = (probes: Awaited<ReturnType<typeof runCreateStress>>['probes'], pos: string, label: string) =>
    probes?.find((p) => p.pos.join() === pos)?.values.find((v) => v.label === label)?.value

  it('石臼の処理時間をレシピから出し、ファンネルとシュートにもプローブを出す', async () => {
    const result = await runCreateStress(line(), { pack: pack(BOOK), ports: [] })
    expect(value(result.probes, '0,1,0', '処理時間')).toEqual({ value: '38 tick（1.9 秒）で1個。32 個/分', source: 'modpack' })
    expect(value(result.probes, '0,1,0', 'レシピ')?.value).toContain('create:milling/wheat')
    const funnel = result.probes?.find((p) => p.pos.join() === '2,0,0')
    expect(funnel?.network).toBeUndefined()
    expect(funnel?.values).toEqual([
      { label: '輸送量', value: { value: '2.5 個/秒（入れ物から取り出すとき。8 tick ごとに 1 個）', source: 'builtin' } },
    ])
    expect(value(result.probes, '3,0,0', '輸送量')).toEqual({
      value: '20 個/秒（入れ物から取り出すとき。8 tick ごとに 8 個）',
      // 間隔は内蔵の初期値なので、弱い方の出どころになる
      source: 'builtin',
    })
    expect(value(result.probes, '4,1,0', '輸送量')?.source).toBe('assumed')
    expect(result.assumptions.map((a) => a.message)).toContain(
      'シュートに扇風機がつながっているが、風は計算せず、重力で落ちる速さで出した',
    )
    expect(structuredClone(result)).toEqual(result)
  })

  it('Modpack がない・レシピがない・スクリプトがレシピを変えているときは仮定に載せる', async () => {
    const none = await runCreateStress(line(), { pack: null, ports: [] })
    expect(value(none.probes, '0,1,0', '処理時間')).toEqual({ value: '25 tick（1.25 秒）で1個。48 個/分', source: 'assumed' })
    expect(none.assumptions.map((a) => a.message)).toContain('石臼のレシピが分からないので、処理時間を Create の初期値の 100 tick とした')

    const noBook = await runCreateStress(line(), { pack: pack(null), ports: [] })
    expect(value(noBook.probes, '0,1,0', '処理時間')?.source).toBe('assumed')

    const failing: CalcModpack = { ...pack(null), recipeBook: async () => Promise.reject(new Error('x')) }
    const failed = await runCreateStress(line(), { pack: failing, ports: [] })
    expect(failed.assumptions.map((a) => a.message)).toContain('Modpack のレシピを読めなかったので、処理時間は Create の初期値で計算した')

    const scripted = await runCreateStress(line(), { pack: pack({ ...BOOK, scriptsChangeRecipes: true }), ports: [] })
    expect(scripted.assumptions.map((a) => a.message).some((m) => m.startsWith('KubeJS のスクリプトがレシピを変えている'))).toBe(
      true,
    )
  })

  it('プレスの値と、止まっているとき', async () => {
    const bp = blueprintFixture()
      .place([0, 0, 0], 'create:creative_motor', { facing: 'east' }, motor64)
      .place([1, 0, 0], 'create:mechanical_press', { facing: 'east' })
      .place([0, 0, 2], 'create:mechanical_press', { facing: 'east' })
      .toBlueprint()
    const result = await runCreateStress(bp, { pack: null, ports: [] })
    expect(value(result.probes, '1,0,0', '処理時間')).toEqual({ value: '30 tick（1.5 秒）で1個。40 個/分', source: 'builtin' })
    expect(value(result.probes, '0,0,2', '処理時間')?.value).toBe('止まっているので動かない')
  })
})
