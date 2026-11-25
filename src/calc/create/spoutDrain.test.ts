import { describe, expect, it } from 'vitest'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { nbt } from '../../domain/nbt'
import type { ProcessingRecipe } from '../../io/modpack/recipes'
import { emptyItem, fillItem, fluidAccepts, spoutFluid, stillFluid, tankFluid } from './spoutDrain'

const filling = (fluids: string[], fluidTags: string[]): ProcessingRecipe => ({
  id: 'x:filling',
  type: 'create:filling',
  items: ['minecraft:glass_bottle'],
  tags: [],
  duration: 0,
  results: [],
  fluids,
  fluidTags,
})

describe('スパウトの液体（#235）', () => {
  it('[TP-SPOUT-FLUID] 生データのタンク：1.18 の FluidName、1.21 の id、ベイスンの InputTanks。空なら null。流れる液体は水源の ID にする', () => {
    const tanks = (key: string, content: Record<string, ReturnType<typeof nbt.string>>) =>
      nbt.compound({ [key]: nbt.list('compound', [nbt.compound({ TankContent: nbt.compound(content) })]) })
    expect(tankFluid(tanks('Tanks', { FluidName: nbt.string('minecraft:water') }))).toBe('minecraft:water')
    expect(tankFluid(tanks('Tanks', { FluidName: nbt.string('minecraft:empty') }))).toBeNull()
    expect(tankFluid(tanks('Tanks', { id: nbt.string('create:honey') }))).toBe('create:honey')
    expect(tankFluid(tanks('InputTanks', { id: nbt.string('minecraft:flowing_lava') }))).toBe('minecraft:lava')
    expect(tankFluid(nbt.compound({ TankContent: nbt.compound({ FluidName: nbt.string('minecraft:lava') }) }))).toBe('minecraft:lava')
    expect(tankFluid(null)).toBeNull()
    expect(tankFluid(nbt.compound({ Tanks: nbt.list('string', [nbt.string('x')]) }))).toBeNull()
    expect(stillFluid('minecraft:flowing_water')).toBe('minecraft:water')
  })

  it('[TP-SPOUT-FLUID] 管の口の先：水浸しのブロック、溶岩入りの大釜、液体タンク（まとめ役が中身を持つ）。口がつながらない管はたどらない', () => {
    const pipeUp = { north: 'false', south: 'false', east: 'false', west: 'false', up: 'true', down: 'true', waterlogged: 'false' }
    const fx = blueprintFixture({ size: [3, 4, 1] })
      .place([0, 0, 0], 'create:spout')
      .place([0, 1, 0], 'create:glass_fluid_pipe', { axis: 'y', waterlogged: 'false' })
      .place([0, 2, 0], 'create:fluid_pipe', pipeUp)
      .place([0, 3, 0], 'minecraft:oak_slab', { type: 'bottom', waterlogged: 'true' })
    expect(spoutFluid(fx.toBlueprint(), [0, 0, 0])).toEqual({ fluid: 'minecraft:water', from: 'pipe', candidates: ['minecraft:water'] })
    fx.place([0, 3, 0], 'minecraft:lava_cauldron')
    expect(spoutFluid(fx.toBlueprint(), [0, 0, 0]).fluid).toBe('minecraft:lava')
    fx.place([0, 3, 0], 'create:fluid_tank', { top: 'true', bottom: 'true', shape: 'window' }, nbt.compound({ Controller: nbt.intArray([1, 3, 0]) }))
      .place([1, 3, 0], 'create:fluid_tank', { top: 'true', bottom: 'true', shape: 'window' }, nbt.compound({ TankContent: nbt.compound({ id: nbt.string('create:chocolate') }) }))
    expect(spoutFluid(fx.toBlueprint(), [0, 0, 0]).fluid).toBe('create:chocolate')
    fx.place([0, 3, 0], 'create:fluid_tank', { top: 'true', bottom: 'true', shape: 'window' }, nbt.compound({ TankContent: nbt.compound({ id: nbt.string('create:tea') }) }))
    expect(spoutFluid(fx.toBlueprint(), [0, 0, 0]).fluid).toBe('create:tea')
    fx.place([0, 3, 0], 'minecraft:water_cauldron', { level: '3' })
    expect(spoutFluid(fx.toBlueprint(), [0, 0, 0]).fluid).toBe('minecraft:water')
    // 液体のない Create のブロック、鍾乳石のない空の大釜、上に液体のない鍾乳石は、液体の出どころでない
    for (const [id, above] of [
      ['create:shaft', null],
      ['minecraft:cauldron', null],
      ['minecraft:cauldron', 'minecraft:pointed_dripstone'],
    ] as const) {
      const f = blueprintFixture({ size: [1, 5, 1] })
        .place([0, 0, 0], 'create:spout')
        .place([0, 1, 0], 'create:fluid_valve', { facing: 'up', enabled: 'false', waterlogged: 'false' })
        .place([0, 2, 0], id, id === 'create:shaft' ? { axis: 'y', waterlogged: 'false' } : {})
      if (above) f.place([0, 3, 0], above, { vertical_direction: 'down', thickness: 'tip', waterlogged: 'false' })
      expect(spoutFluid(f.toBlueprint(), [0, 0, 0]).fluid).toBeNull()
    }
    // 向きのないポンプ、横向きのガラスの管は、上下につながらない
    fx.place([0, 1, 0], 'create:mechanical_pump', {})
    expect(spoutFluid(fx.toBlueprint(), [0, 0, 0]).fluid).toBeNull()
    fx.place([0, 1, 0], 'create:glass_fluid_pipe', { axis: 'x', waterlogged: 'false' })
    expect(spoutFluid(fx.toBlueprint(), [0, 0, 0])).toEqual({ fluid: null, from: 'unknown', candidates: [] })
  })

  it('[TP-SPOUT] 液体のタグ：minecraft:water・lava はその液体、ほかはタグの名前の最後が液体の名前と同じなら合う', () => {
    expect(fluidAccepts(filling(['minecraft:water'], []), 'minecraft:flowing_water')).toBe(true)
    expect(fluidAccepts(filling([], ['minecraft:water']), 'minecraft:water')).toBe(true)
    expect(fluidAccepts(filling([], ['minecraft:water']), 'minecraft:lava')).toBe(false)
    expect(fluidAccepts(filling([], ['forge:honey']), 'create:honey')).toBe(true)
    expect(fluidAccepts(filling([], ['c:fluids/tea']), 'create:tea')).toBe(true)
    expect(fluidAccepts(filling([], ['c:honey']), 'create:chocolate')).toBe(false)
    // 液体の材料を持たないレシピには合わない
    const { fluids: _f, fluidTags: _t, ...plain } = filling([], [])
    expect(fluidAccepts(plain, 'minecraft:water')).toBe(false)
  })

  it('[TP-SPOUT][TP-ITEM-DRAIN] Create の決まり：バケツ・ガラス瓶に入れる、ポーション・液体のバケツから抜く。粉雪のバケツは抜かない', () => {
    expect(fillItem('minecraft:bucket', 'minecraft:water', null)?.recipe.results[0]?.item).toBe('minecraft:water_bucket')
    expect(fillItem('minecraft:glass_bottle', 'minecraft:lava', null)).toBeNull()
    expect(fillItem('minecraft:stone', 'minecraft:water', null)).toBeNull()
    expect(emptyItem('minecraft:lingering_potion', null)?.recipe.results[0]?.item).toBe('minecraft:glass_bottle')
    expect(emptyItem('minecraft:lava_bucket', null)?.recipe.results[0]?.item).toBe('minecraft:bucket')
    expect(emptyItem('minecraft:powder_snow_bucket', null)).toBeNull()
    expect(emptyItem('minecraft:bucket', null)).toBeNull()
  })

  it('[TP-SPOUT] 合うレシピが2つ以上なら ID の名前順で最初のものを使い、仮定に載せる', () => {
    const book = {
      recipes: [
        { ...filling(['minecraft:water'], []), id: 'b:x', results: [{ item: 'b:out', count: 1, chance: 1 }] },
        { ...filling(['minecraft:water'], []), id: 'a:x', results: [{ item: 'a:out', count: 1, chance: 1 }] },
        { ...filling(['minecraft:water'], []), id: 'c:x', results: [{ item: 'c:out', count: 1, chance: 1 }] },
      ],
      scriptsChangeRecipes: false,
      itemTags: {},
    }
    const p = fillItem('minecraft:glass_bottle', 'minecraft:water', book)
    expect(p?.recipe.id).toBe('a:x')
    expect(p?.assumption).toBe('スパウトの材料 minecraft:glass_bottle に合うレシピが 3 つあるので、ID の名前順で最初の a:x を使った')
  })
})

describe('スパウトの液体の抜け', () => {
  it('管の口の先が、液体を持たないふつうのブロックなら、液体は分からない', () => {
    const bp = blueprintFixture({ size: [2, 2, 1] })
      .place([0, 0, 0], 'create:spout')
      .place([1, 0, 0], 'minecraft:stone')
      .place([0, 1, 0], 'minecraft:oak_planks')
      .toBlueprint()
    expect(spoutFluid(bp, [0, 0, 0])).toEqual({ fluid: null, from: 'unknown', candidates: [] })
  })

  it('流れている水（level が 0 でない）は、管の口の先でも鍾乳石の上でも液体の出どころでない', () => {
    const flowing = blueprintFixture({ size: [1, 2, 1] })
      .place([0, 0, 0], 'create:spout')
      .place([0, 1, 0], 'minecraft:water', { level: '3' })
      .toBlueprint()
    expect(spoutFluid(flowing, [0, 0, 0]).fluid).toBeNull()
    const drip = (level: string) =>
      blueprintFixture({ size: [1, 7, 1] })
        .place([0, 0, 0], 'create:spout')
        .place([0, 1, 0], 'create:fluid_valve', { facing: 'up', enabled: 'false', waterlogged: 'false' })
        .place([0, 2, 0], 'minecraft:cauldron')
        .place([0, 3, 0], 'minecraft:pointed_dripstone', { vertical_direction: 'down', thickness: 'tip', waterlogged: 'false' })
        .place([0, 4, 0], 'minecraft:stone')
        .place([0, 5, 0], 'minecraft:water', { level })
        .toBlueprint()
    expect(spoutFluid(drip('0'), [0, 0, 0]).fluid).toBe('minecraft:water')
    expect(spoutFluid(drip('2'), [0, 0, 0]).fluid).toBeNull()
  })
})
