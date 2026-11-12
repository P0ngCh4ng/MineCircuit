import { describe, expect, it } from 'vitest'
import type { Blueprint } from '../../domain/blueprint'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { nbt } from '../../domain/nbt'
import type { ProcessingRecipe, RecipeBook } from '../../io/modpack/recipes'
import { AssumptionLog } from '../assumptionLog'
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
  kineticThroughputValues,
  machineCapacityPerMinute,
  machineCycleTicks,
  millstoneTicks,
  mixerCycleTicks,
  mixerMixingTicks,
  pressCycleTicks,
  recipeAccepts,
  sawTicks,
  staticThroughputValues,
  type KineticInput,
  type ThroughputEnv,
} from './createThroughput'
import { readCreateServerConfig } from './createConfig'
import { runCreateStress } from './createStressPlugin'
import { CreateValueResolver } from './createValueResolver'

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
  it('[TP-BELT-RATE] ベルト：2.67 ブロック/秒。1個ずつ 2.67 個/秒、64 個ずつ 171 個/秒', () => {
    expect(beltSpeed(64)).toBeCloseTo(2.667, 3)
    expect(formatRate(beltSpeed(64))).toBe('2.67')
    expect(formatRate(beltSpeed(64) * 64)).toBe('171')
  })

  it('[TP-ARM-RATE] 機械アーム：16 tick × 4 で1往復 3.2 秒。1個ずつ 0.31 個/秒', () => {
    const ticks = armRoundTripTicks(64)!
    expect(ticks).toBe(64)
    expect(ticks / 20).toBe(3.2)
    expect(formatRate(20 / ticks)).toBe('0.31')
    // 256 RPM より速くても 1 tick に 256 / 1024 まで
    expect(armRoundTripTicks(256)).toBe(16)
    expect(armRoundTripTicks(0)).toBeNull()
  })

  it('[TP-FUNNEL-RATE] 安山岩のファンネル：1 個 / 8 tick で 2.5 個/秒', () => {
    const amount = funnelAmount('andesite_funnel', null)
    expect(amount).toEqual({ value: 1, source: 'builtin' })
    expect(funnelItemsPerSecond(amount.value, 8)).toBe(2.5)
  })

  it('[TP-FUNNEL-RATE] 真鍮のファンネル：フィルターの数（FilterAmount）を使う', () => {
    expect(funnelAmount('brass_funnel', nbt.compound({ FilterAmount: nbt.int(16) }))).toEqual({ value: 16, source: 'blueprint' })
    expect(funnelAmount('brass_funnel', null)).toEqual({ value: 64, source: 'builtin' })
    expect(funnelItemsPerSecond(16, 8)).toBe(40)
  })

  it('[TP-PRESS-TIME] プレス：30 tick（1.5 秒）で1個、40 個/分', () => {
    const ticks = pressCycleTicks(64)!
    expect(ticks).toBe(30)
    expect(1200 / ticks).toBe(40)
    expect(pressCycleTicks(0)).toBeNull()
  })

  it('[TP-MIXER-TIME] ミキサー（処理時間なし）：46 + 40 = 86 tick（4.3 秒）で1回、14 回/分', () => {
    const ticks = mixerCycleTicks(64, 0)!
    expect(ticks).toBe(86)
    expect(formatRate(1200 / ticks)).toBe('14')
    // 処理時間 100 は r = 1 で同じ
    expect(mixerCycleTicks(64, 100)).toBe(86)
  })

  it('[TP-MILLSTONE-TIME] 石臼（処理時間 100）：25 tick（1.25 秒）で1個、48 個/分', () => {
    const ticks = millstoneTicks(64, 100)!
    expect(ticks).toBe(25)
    expect(1200 / ticks).toBe(48)
    // ゲームで確かめる手順の小麦（処理時間 150）
    expect(millstoneTicks(64, 150)).toBe(38)
  })

  it('[TP-CRUSHING-TIME] 粉砕ホイール（処理時間 100、1個）：6 tick で1個', () => {
    expect(crushingTicks(64, 100, 1)).toBe(6)
    // 64 個：100 → 20 未満に 0.853 ずつ 94 tick、そのあと 5.12 ずつ 4 tick
    expect(crushingTicks(64, 100, 64)).toBe(98)
    expect(crushingTicks(0, 100, 1)).toBeNull()
  })

  it('[TP-SAW-TIME] ソー（処理時間 50、1個）：25 tick で1個', () => {
    expect(sawTicks(64, 50, 1)).toBe(25)
    // 64 個：50 × ⌊64 / 5⌋ = 600。595 を切るのに 224 tick、20 → 0 に 8 tick
    expect(sawTicks(64, 50, 64)).toBe(232)
  })

  it('[TP-DEPLOYER-TIME] デプロイヤー：8 + 8 + 4 = 20 tick（1 秒）で1回', () => {
    expect(deployerCycleTicks(64)).toBe(20)
    expect(deployerCycleTicks(0)).toBeNull()
  })
})

describe('どのレシピか', () => {
  it('[TP-RECIPE-BY-CONTENTS] 生データの中のアイテム（1.18 の Count と 1.20.5 の count）を探す', () => {
    const be = nbt.compound({
      id: nbt.string('create:millstone'),
      InputInventory: nbt.compound({ Items: nbt.list('compound', [item('minecraft:wheat', 12)]) }),
      Other: nbt.compound({ item: nbt.compound({ id: nbt.string('minecraft:bone'), count: nbt.int(3) }) }),
      Empty: item('minecraft:air'),
    })
    expect(findItemIds(be)).toEqual(['minecraft:wheat', 'minecraft:bone'])
    expect(findItemIds(null)).toEqual([])
  })

  it('[TP-RECIPE-BY-CONTENTS] 生データの物を材料に持つレシピを使う', () => {
    const choice = chooseRecipe('milling', ['minecraft:wheat'], BOOK)
    expect(choice.duration).toEqual({ value: 150, source: 'modpack', note: 'create:milling/wheat' })
    expect(choice.assumption).toBeNull()
    expect(choice.text).toContain('create:milling/wheat')
  })

  it('[TP-RECIPE-FALLBACK] 決まらなければ範囲を出し、初期値で計算して仮定に載せる', () => {
    const choice = chooseRecipe('milling', ['minecraft:stone'], BOOK)
    expect(choice.duration).toEqual({ value: 100, source: 'assumed' })
    expect(choice.assumption).toContain('50〜250 tick')
    expect(chooseRecipe('cutting', [], BOOK).duration.value).toBe(50)
    // ミキサーの処理時間なしは 100（r = 1）
    expect(chooseRecipe('mixing', ['minecraft:andesite'], BOOK).duration).toMatchObject({ value: 100, source: 'modpack' })
  })

  it('[TP-RECIPE-NO-PACK] Modpack がなければ初期値だけ', () => {
    const choice = chooseRecipe('crushing', ['minecraft:wheat'], null)
    expect(choice.duration).toEqual({ value: 100, source: 'assumed' })
    expect(choice.assumption).not.toContain('Modpack')
  })

  it('[TP-RECIPE-FALLBACK] プレス・圧縮は処理時間を使わないので、仮定に時間を書かない', () => {
    for (const type of ['pressing', 'compacting'] as const) {
      const choice = chooseRecipe(type, ['minecraft:stone'], BOOK)
      expect(choice.recipe).toBeNull()
      expect(choice.assumption).not.toContain('tick')
      expect(choice.text).toBe('分からない')
    }
    expect(chooseRecipe('pressing', [], null).assumption).toBe('プレスのレシピが分からない')
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

  it('[TP-MILLSTONE-TIME][TP-CHUTE-RATE] 石臼の処理時間をレシピから出し、ファンネルとシュートにもプローブを出す', async () => {
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

  it('[TP-RECIPE-NO-PACK] Modpack がない・レシピがない・スクリプトがレシピを変えているときは仮定に載せる', async () => {
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

  it('[TP-PRESS-TIME] プレスの値と、止まっているとき', async () => {
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

describe('設定ファイル', () => {
  it('[TP-CONFIG] create-server.toml の defaultExtractionTimer・bulkPressing を読み、なければ初期値（8 tick、false）', () => {
    const path = 'saves/w/serverconfig/create-server.toml'
    const set = new CreateValueResolver(
      readCreateServerConfig('[logistics]\n  defaultExtractionTimer = 4\n[recipes]\n  bulkPressing = true\n', path),
    )
    expect(set.extractionTimer()).toMatchObject({ value: 4, source: 'modpack' })
    expect(set.bulkPressing()).toMatchObject({ value: true, source: 'modpack' })
    for (const values of [new CreateValueResolver(readCreateServerConfig('[kinetics]\n', path)), new CreateValueResolver(null)]) {
      expect(values.extractionTimer()).toEqual({ value: 8, source: 'builtin' })
      expect(values.bulkPressing()).toEqual({ value: false, source: 'builtin' })
    }
  })
})

describe('輸送量・処理時間の分かれ道（#237）', () => {
  const env = (bp: Blueprint, over: Partial<ThroughputEnv> = {}): ThroughputEnv => ({
    bp,
    values: new CreateValueResolver(null),
    recipes: BOOK,
    log: new AssumptionLog(),
    ...over,
  })
  const turning = (rpm: number, minSpeed = 0): KineticInput => ({ rpm, source: 'blueprint', minSpeed })
  const text = (items: readonly { label: string; value: { value: string } }[], label: string) =>
    items.find((v) => v.label === label)?.value.value

  it('[TP-MIXER-TIME][TP-MILLSTONE-TIME][TP-CRUSHING-TIME][TP-SAW-TIME] 止まっていれば時間を出さない', () => {
    expect(mixerMixingTicks(0, 0)).toBeNull()
    expect(mixerCycleTicks(0, 0)).toBeNull()
    expect(millstoneTicks(0, 100)).toBeNull()
    expect(crushingTicks(0, 100, 1)).toBeNull()
    expect(sawTicks(0, 50, 1)).toBeNull()
    expect(machineCapacityPerMinute('millstone', 0, 100, false)).toBeNull()
  })

  it('[TP-MIXER-TIME] 512 RPM を超えると混ぜる時間は 1 tick（log2(0) は 0）', () => {
    expect(mixerMixingTicks(1024, 0)).toBe(1)
  })

  it('[TP-CRUSHING-TIME] 処理時間が 20 より短いと、最初の tick に結果ができる', () => {
    // 64 RPM で s = 5.12。1 tick 目に 10 → 4.88、2 tick 目で 0 以下
    expect(crushingTicks(64, 10, 1)).toBe(2)
  })

  it('[TP-PRESS-TIME][TP-DEPLOYER-TIME][TP-BOTTLENECK-MACHINES] 処理できる数・1回分の時間。知らない機械は null', () => {
    expect(machineCapacityPerMinute('mechanical_press', 64, 0, true)).toBe(40 * 64)
    expect(machineCapacityPerMinute('mechanical_press', 64, 0, false)).toBe(40)
    expect(machineCapacityPerMinute('belt', 64, 0, false)).toBeNull()
    expect(machineCycleTicks('deployer', 64, 0)).toBe(20)
    expect(machineCycleTicks('belt', 64, 0)).toBeNull()
  })

  it('[TP-RECIPE-TIE][TP-RECIPE-TAGS] 3つ以上合っても名前順で最初。Modpack がなければタグでは照らせない', () => {
    const book: RecipeBook = {
      recipes: ['b', 'c', 'a', 'b'].map((n) => recipe(`pack:milling/${n}`, 'milling', ['minecraft:wheat'], 100)),
      scriptsChangeRecipes: false,
      itemTags: {},
    }
    expect(chooseRecipe('milling', ['minecraft:wheat'], book).recipe?.id).toBe('pack:milling/a')
    const tagged: ProcessingRecipe = { ...recipe('pack:milling/t', 'milling', [], 100), tags: ['c:grain'] }
    expect(recipeAccepts(tagged, 'minecraft:wheat', null)).toBe(false)
  })

  it('[TP-ARM-RATE][TP-DEPLOYER-TIME][TP-PRESS-TIME] 機械アーム・デプロイヤー・スタックごと押すプレスのプローブ', () => {
    const e = env(blueprintFixture().toBlueprint(), {
      values: new CreateValueResolver(readCreateServerConfig('[recipes]\n  bulkPressing = true\n', 'p')),
    })
    expect(text(kineticThroughputValues([0, 0, 0], 'create:mechanical_arm', turning(64), e), '輸送量')).toBe(
      '1往復 3.2 秒（64 tick）。1個ずつ 0.31 個/秒、64 個ずつ 20 個/秒',
    )
    expect(text(kineticThroughputValues([0, 0, 0], 'create:deployer', turning(64), e), '処理時間')).toBe('20 tick（1 秒）で1回。60 回/分')
    const press = kineticThroughputValues([0, 0, 0], 'create:mechanical_press', turning(64), e)[0]!
    expect(press.value).toEqual({ value: '30 tick（1.5 秒）で1スタック（最大 64 個）。2,560 個/分', source: 'modpack' })
  })

  it('[TP-CRUSHING-TIME][TP-SAW-TIME] 粉砕ホイール・ソーは 1個と 64 個まとめての時間。中身は隣の中心から読む', () => {
    const bp = blueprintFixture()
      .place([0, 0, 0], 'create:crushing_wheel', { axis: 'z' })
      .place([1, 0, 0], 'create:crushing_wheel_controller', { facing: 'down' })
      .place([0, 0, 3], 'create:crushing_wheel', { axis: 'z' })
      .toBlueprint()
    const e = env(bp)
    const withController = kineticThroughputValues([0, 0, 0], 'create:crushing_wheel', turning(64), e)
    expect(text(withController, '処理時間')).toMatch(/^1個なら .*、64 個まとめてなら /)
    expect(text(kineticThroughputValues([0, 0, 3], 'create:crushing_wheel', turning(64), e), 'レシピ')).toBeDefined()
    expect(text(kineticThroughputValues([5, 0, 5], 'create:mechanical_saw', turning(64), e), '処理時間')).toMatch(/64 個まとめてなら/)
  })

  it('[TP-RECIPE-BY-PATH] 物の通り道で届く物があれば、生データの物より先に使う', () => {
    const bp = blueprintFixture()
      .place([0, 0, 0], 'create:millstone', nbt.compound({ InputInventory: nbt.compound({ Items: nbt.list('compound', [item('minecraft:wheat')]) }) }))
      .toBlueprint()
    const e = env(bp, { pathItems: () => ['minecraft:bone'] })
    expect(text(kineticThroughputValues([0, 0, 0], 'create:millstone', turning(64), e), 'レシピ')).toContain('create:milling/bone')
    const none = env(bp, { pathItems: () => [] })
    expect(text(kineticThroughputValues([0, 0, 0], 'create:millstone', turning(64), none), 'レシピ')).toContain('create:milling/wheat')
  })

  it('[ST-MIN-SPEED] 回転数が必要回転数より小さければ動かない。関係しないブロックは何も出さない', () => {
    const e = env(blueprintFixture().toBlueprint())
    expect(text(kineticThroughputValues([0, 0, 0], 'create:mechanical_mixer', turning(8, 16), e), '処理時間')).toBe(
      '回転数が足りないので動かない（16 RPM 以上が必要）',
    )
    expect(kineticThroughputValues([0, 0, 0], 'minecraft:stone', turning(64), e)).toEqual([])
    expect(kineticThroughputValues([0, 0, 0], 'create:shaft', turning(64), e)).toEqual([])
    expect(staticThroughputValues([0, 0, 0], 'create:shaft', e)).toBeNull()
  })

  it('[TP-CHUTE-RATE] 扇風機のないシュートは、重力で落ちる速さを内蔵の値で出す', () => {
    const e = env(blueprintFixture().place([0, 1, 0], 'create:chute').toBlueprint())
    expect(staticThroughputValues([0, 1, 0], 'create:smart_chute', e)?.[0]?.value).toEqual({
      value: '4 マス/秒（重力で落ちるとき。1個ずつ 4 個/秒、64 個ずつ 256 個/秒）',
      source: 'builtin',
    })
    expect(e.log.list()).toEqual([])
  })
})
