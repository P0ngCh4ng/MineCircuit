import { describe, expect, it } from 'vitest'
import { BlockState } from '../../domain/blockState'
import { ResourceLocation } from '../../domain/resourceLocation'
import { MemoryAssetReader } from '../../../tests/fixtures/fakeAppearance'
import { itemModelCandidates, itemSpriteAppearance } from './itemSpriteModel'
import { ModelResolver } from './modelResolver'

const state = (id: string, props: Record<string, string> = {}) => new BlockState(ResourceLocation.parse(id), props)
const json = (v: unknown) => JSON.stringify(v)

describe('アイテムの絵の板（#223）', () => {
  it('アイテムのモデルの候補：ブロック名、なければ wall_ を除いた名前', () => {
    expect(itemModelCandidates(state('minecraft:oak_sign'))).toEqual(['minecraft:item/oak_sign'])
    expect(itemModelCandidates(state('minecraft:oak_wall_sign'))).toEqual(['minecraft:item/oak_wall_sign', 'minecraft:item/oak_sign'])
    expect(itemModelCandidates(state('minecraft:wall_torch'))).toEqual(['minecraft:item/wall_torch', 'minecraft:item/torch'])
  })

  it('板はブロックの真ん中に立て、表と裏に絵を貼る。facing と rotation で回す', () => {
    const wall = itemSpriteAppearance(state('minecraft:oak_wall_sign', { facing: 'east' }), 'minecraft:item/oak_sign').parts[0]!
    expect(wall.y).toBe(90)
    const board = wall.model.elements[0]!
    expect([board.from, board.to, board.rotation]).toEqual([[0, 0, 8], [16, 16, 8], null])
    expect(Object.keys(board.faces).sort()).toEqual(['north', 'south'])
    expect(board.faces.north).toMatchObject({ texture: 'minecraft:item/oak_sign', uv: [0, 0, 16, 16], cullface: null })
    // rotation 0 は南、4 は西、8 は北。間は要素の回転で 22.5 度ずつ
    const turn = (r: number) => itemSpriteAppearance(state('minecraft:oak_sign', { rotation: String(r) }), 'minecraft:item/oak_sign').parts[0]!
    expect([turn(0).y, turn(4).y, turn(8).y, turn(12).y]).toEqual([180, 270, 0, 90])
    expect(turn(1).y).toBe(180)
    expect(turn(1).model.elements[0]!.rotation).toEqual({ origin: [8, 8, 8], axis: 'y', angle: -22.5, rescale: false })
    expect(turn(3).y).toBe(270)
    expect(turn(3).model.elements[0]!.rotation?.angle).toBe(22.5)
  })

  it('ModelResolver：形のないブロックで、アイテムの絵が平らなら板。平らでなければ particle の箱', async () => {
    const reader = new MemoryAssetReader({
      'assets/minecraft/blockstates/oak_wall_sign.json': json({ variants: { '': { model: 'minecraft:block/oak_sign' } } }),
      'assets/minecraft/blockstates/white_bed.json': json({ variants: { '': { model: 'minecraft:block/white_bed' } } }),
      'assets/minecraft/models/block/oak_sign.json': json({ textures: { particle: 'minecraft:block/oak_planks' } }),
      'assets/minecraft/models/block/white_bed.json': json({ textures: { particle: 'minecraft:block/white_wool' } }),
      'assets/minecraft/models/item/oak_sign.json': json({ parent: 'minecraft:item/generated', textures: { layer0: 'minecraft:item/oak_sign' } }),
      'assets/minecraft/models/item/generated.json': json({ parent: 'builtin/generated' }),
      'assets/minecraft/models/item/white_bed.json': json({ parent: 'minecraft:item/template_bed' }),
      'assets/minecraft/models/item/template_bed.json': json({ parent: 'builtin/entity' }),
    })
    const resolver = new ModelResolver(reader)
    const sign = await resolver.resolve(state('minecraft:oak_wall_sign', { facing: 'south', waterlogged: 'false' }))
    expect(sign!.parts[0]!.model.id).toBe('minecraft:oak_wall_sign#sprite')
    expect(sign!.parts[0]!.model.elements[0]!.faces.north!.texture).toBe('minecraft:item/oak_sign')
    const bed = await resolver.resolve(state('minecraft:white_bed', { facing: 'north', part: 'head', occupied: 'false' }))
    expect(bed!.parts[0]!.model.id).toBe('minecraft:white_bed#particle')
    expect(resolver.problems).toEqual([])
  })
})
