import { describe, expect, it } from 'vitest'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { BlockState } from '../../domain/blockState'
import { nbt } from '../../domain/nbt'
import { ResourceLocation } from '../../domain/resourceLocation'
import type { ProcessingRecipe, RecipeBook } from '../../io/modpack/recipes'
import {
  crafterCycleTicks,
  crafterGroup,
  crafterInputController,
  crafterOutput,
  crafterSpeed,
  crafterTarget,
  crafterTargetDirection,
  craftingRemainder,
  gridCoord,
  matchCrafting,
} from './mechanicalCrafter'

const crafter = (facing: string, pointing?: string) =>
  new BlockState(ResourceLocation.parse('create:mechanical_crafter'), pointing ? { facing, pointing } : { facing })

describe('メカニカルクラフター（#235）', () => {
  it('[TP-CRAFTER-GRID] 矢印の向き：up・down はそのまま、left は facing を時計回り、right は反時計回り', () => {
    expect(crafterTargetDirection(crafter('north', 'up'))).toBe('up')
    expect(crafterTargetDirection(crafter('north', 'down'))).toBe('down')
    expect(crafterTargetDirection(crafter('north', 'left'))).toBe('east')
    expect(crafterTargetDirection(crafter('north', 'right'))).toBe('west')
    expect(crafterTargetDirection(crafter('south', 'right'))).toBe('east')
    expect(crafterTargetDirection(crafter('east', 'left'))).toBe('south')
    expect(crafterTargetDirection(crafter('north'))).toBe('up')
    expect(crafterTargetDirection(crafter('north', 'sideways'))).toBeNull()
    expect(crafterTargetDirection(crafter('up', 'up'))).toBeNull()
    expect(crafterTargetDirection(new BlockState(ResourceLocation.parse('minecraft:stone')))).toBeNull()
  })

  it('[TP-CRAFTER-GRID] 渡す先は同じ facing のクラフターで、pointing が逆向きでないもの。組は渡す・渡されるでつながったもの', () => {
    const fx = blueprintFixture({ size: [3, 2, 1] })
      .place([0, 0, 0], 'create:mechanical_crafter', { facing: 'north', pointing: 'up' })
      .place([0, 1, 0], 'create:mechanical_crafter', { facing: 'north', pointing: 'down' })
      .place([1, 0, 0], 'create:mechanical_crafter', { facing: 'south', pointing: 'up' })
      .place([2, 0, 0], 'create:mechanical_crafter', { facing: 'north', pointing: 'up' })
    const bp = fx.toBlueprint()
    // 上下で向かい合う2台は渡し合わない
    expect(crafterTarget(bp, [0, 0, 0])).toBeNull()
    expect(crafterTarget(bp, [0, 1, 0])).toBeNull()
    expect(crafterTarget(bp, [9, 9, 9])).toBeNull()
    expect(crafterGroup(bp, [0, 0, 0])?.members).toEqual([[0, 0, 0]])
    expect(crafterGroup(bp, [5, 5, 5])).toBeNull()
    // 輪になった組は、最初の1台を最後とする
    const ring = blueprintFixture({ size: [2, 2, 1] })
      .place([0, 0, 0], 'create:mechanical_crafter', { facing: 'south', pointing: 'right' })
      .place([1, 0, 0], 'create:mechanical_crafter', { facing: 'south', pointing: 'up' })
      .place([1, 1, 0], 'create:mechanical_crafter', { facing: 'south', pointing: 'left' })
      .place([0, 1, 0], 'create:mechanical_crafter', { facing: 'south', pointing: 'down' })
      .toBlueprint()
    const g = crafterGroup(ring, [0, 0, 0])
    expect(g?.members).toHaveLength(4)
    expect(g?.final).toEqual([0, 0, 0])
  })

  it('[TP-CRAFTER-GRID] 入力のまとめ役：Controller が偽なら Data の1つ目。つないでいなければ自分', () => {
    const fx = blueprintFixture({ size: [3, 1, 1] })
      .place([0, 0, 0], 'create:mechanical_crafter', { facing: 'north', pointing: 'up' }, nbt.compound({ ConnectedInput: nbt.compound({ Controller: nbt.byte(1) }) }))
      .place(
        [1, 0, 0],
        'create:mechanical_crafter',
        { facing: 'north', pointing: 'up' },
        nbt.compound({ ConnectedInput: nbt.compound({ Controller: nbt.byte(0), Data: nbt.list('compound', [nbt.compound({ X: nbt.int(-1) })]) }) }),
      )
      .place(
        [2, 0, 0],
        'create:mechanical_crafter',
        { facing: 'north', pointing: 'up' },
        nbt.compound({ ConnectedInput: nbt.compound({ Controller: nbt.byte(0), Data: nbt.list('string', [nbt.string('x')]) }) }),
      )
    const bp = fx.toBlueprint()
    expect(crafterInputController(bp, [0, 0, 0])).toEqual([0, 0, 0])
    expect(crafterInputController(bp, [1, 0, 0])).toEqual([0, 0, 0])
    expect(crafterInputController(bp, [2, 0, 0])).toEqual([2, 0, 0])
    expect(crafterOutput(bp, [0, 0, 0])).toEqual({ to: [0, 0, -1], face: null, ejected: true })
  })

  it('[TP-CRAFTER] 速さは |回転数| を 4〜250 に収めた値。1回の時間は、渡す段階（1 + ⌊1000/s⌋ + 1）と作る段階（1 + ⌊2000/s⌋ + 1）の合計', () => {
    expect(crafterSpeed(0)).toBe(0)
    expect(crafterSpeed(-2)).toBe(4)
    expect(crafterSpeed(300)).toBe(250)
    expect(crafterSpeed(32.7)).toBe(32)
    expect(crafterCycleTicks(1, 250)).toBe(10)
    expect(crafterCycleTicks(3, 4)).toBe(2 * 252 + 502)
    // 北向きの右は西
    expect(gridCoord([-2, 3, 5], [0, 1, 5], 'north')).toEqual([2, 2])
    expect(gridCoord([1, 1, 0], [0, 1, 0], 'south')).toEqual([1, 0])
  })

  it('[TP-CRAFTER-RECIPE] 合うレシピが2つ以上なら ID の名前順で最初のもの。タグの材料も照らす。容器の残る材料', () => {
    const r = (id: string, type: ProcessingRecipe['type'], tags: string[]): ProcessingRecipe => ({
      id,
      type,
      items: [],
      tags,
      duration: 0,
      results: [{ item: id, count: 1, chance: 1 }],
      grid: type === 'crafting_shapeless' ? { rows: null, ingredients: [{ items: [], tags }], mirrored: true } : { rows: [[{ items: [], tags }]], ingredients: [], mirrored: true },
    })
    const book: RecipeBook = {
      recipes: [r('b:x', 'crafting_shapeless', ['c:gems']), r('a:x', 'crafting_shaped', ['c:gems']), r('c:x', 'mechanical_crafting', ['c:gems'])],
      scriptsChangeRecipes: false,
      itemTags: { 'c:gems': ['minecraft:diamond'] },
    }
    const m = matchCrafting([{ pos: [0, 0, 0], coord: [0, 0], items: ['minecraft:diamond'] }], book)
    expect(m).toMatchObject({ count: 2, items: ['minecraft:diamond'], unordered: false })
    expect(m?.recipe.id).toBe('a:x')
    // 作業台のレシピがなければメカニカルクラフターのレシピ
    const mech = matchCrafting([{ pos: [0, 0, 0], coord: [0, 0], items: ['minecraft:diamond'] }], { ...book, recipes: [book.recipes[2]!] })
    expect(mech?.recipe.id).toBe('c:x')
    expect(matchCrafting([{ pos: [0, 0, 0], coord: [0, 0], items: ['minecraft:stone'] }], book)).toBeNull()
    // 形のあるレシピの空いた行・列は除いて照らす。並びの大きさが違えば合わない
    const padded: ProcessingRecipe = {
      ...r('d:x', 'crafting_shaped', ['c:gems']),
      grid: { rows: [[null, null], [null, { items: [], tags: ['c:gems'] }]], ingredients: [], mirrored: false },
    }
    expect(matchCrafting([{ pos: [0, 0, 0], coord: [3, 7], items: ['minecraft:diamond'] }], { ...book, recipes: [padded] })?.recipe.id).toBe('d:x')
    const empty: ProcessingRecipe = { ...padded, grid: { rows: [[null]], ingredients: [], mirrored: false } }
    expect(matchCrafting([{ pos: [0, 0, 0], coord: [0, 0], items: ['minecraft:diamond'] }], { ...book, recipes: [empty] })).toBeNull()
    expect(
      matchCrafting(
        [
          { pos: [0, 0, 0], coord: [0, 0], items: ['minecraft:diamond'] },
          { pos: [0, 1, 0], coord: [0, 1], items: ['minecraft:diamond'] },
        ],
        { ...book, recipes: [padded] },
      ),
    ).toBeNull()
    // 数と種類だけで照らす：2つのマスを入れ替えて組めるか
    const pair: ProcessingRecipe = {
      ...r('e:x', 'crafting_shapeless', []),
      grid: { rows: null, ingredients: [{ items: ['x:a'], tags: [] }, { items: ['x:b'], tags: [] }], mirrored: true },
    }
    const slots = [
      { pos: [0, 0, 0] as const, coord: [0, 0] as const, items: ['x:a', 'x:b'] },
      { pos: [1, 0, 0] as const, coord: [1, 0] as const, items: ['x:a'] },
    ]
    expect(matchCrafting(slots, { ...book, recipes: [pair] })).toMatchObject({ items: ['x:b', 'x:a'], unordered: true })
    expect(matchCrafting([{ pos: [0, 0, 0], coord: [0, 0], items: ['x:a', 'x:c'] }, { pos: [1, 0, 0], coord: [1, 0], items: ['x:a'] }], { ...book, recipes: [pair] })).toBeNull()
    expect(craftingRemainder('minecraft:lava_bucket')).toBe('minecraft:bucket')
    expect(craftingRemainder('minecraft:dragon_breath')).toBe('minecraft:glass_bottle')
    expect(craftingRemainder('minecraft:stone')).toBeNull()
  })
})
