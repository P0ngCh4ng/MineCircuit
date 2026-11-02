import { describe, expect, it } from 'vitest'
import { BlockState } from '../../domain/blockState'
import { ResourceLocation } from '../../domain/resourceLocation'
import { MemoryAssetReader } from '../../../tests/fixtures/fakeAppearance'
import { chestAppearance } from './chestModel'
import { ModelResolver } from './modelResolver'

const state = (id: string, props: Record<string, string> = {}) => new BlockState(ResourceLocation.parse(id), props)

describe('chestAppearance（#219）', () => {
  it('1つのチェスト：本体とふたの2つの要素。前の帯を北に貼り、facing に向けて回す。横の面は上下を返す', () => {
    const chest = chestAppearance(state('minecraft:chest', { facing: 'east', type: 'single', waterlogged: 'false' }))!
    expect(chest.texturePath).toBe('assets/minecraft/textures/entity/chest/normal.png')
    const part = chest.appearance.parts[0]!
    expect(part.y).toBe(90)
    const [base, lid] = part.model.elements
    expect([base!.from, base!.to]).toEqual([[0, 0, 0], [16, 16 * (10 / 15), 16]])
    expect([lid!.from, lid!.to]).toEqual([[0, 16 * (10 / 15), 0], [16, 16, 16]])
    // 前は u 42〜56、本体の帯は v 33〜43（上下を返すので v の始まりが 43）
    expect(base!.faces.north).toMatchObject({ texture: 'minecraft:entity/chest/normal', uv: [10.5, 10.75, 14, 8.25], cullface: 'north' })
    expect(lid!.faces.up?.uv).toEqual([7, 0, 10.5, 3.5])
    expect(base!.faces.down?.uv).toEqual([3.5, 4.75, 7, 8.25])
    expect(base!.faces.up).toBeUndefined()
    expect(lid!.faces.down).toBeUndefined()
  })

  it('大きいチェストの半分：錠前の影がもう半分の側に来る絵を使う。トラップ・エンダーも', () => {
    expect(chestAppearance(state('minecraft:chest', { facing: 'north', type: 'left' }))!.texturePath).toBe('assets/minecraft/textures/entity/chest/normal_right.png')
    expect(chestAppearance(state('minecraft:trapped_chest', { facing: 'north', type: 'right' }))!.texturePath).toBe(
      'assets/minecraft/textures/entity/chest/trapped_left.png',
    )
    expect(chestAppearance(state('minecraft:ender_chest', { facing: 'south' }))!.appearance.parts[0]!.y).toBe(180)
    expect(chestAppearance(state('minecraft:barrel'))).toBeNull()
  })

  it('ModelResolver：絵があればチェストの箱、なければ particle の箱', async () => {
    const files = {
      'assets/minecraft/blockstates/chest.json': JSON.stringify({ variants: { '': { model: 'minecraft:block/chest' } } }),
      'assets/minecraft/models/block/chest.json': JSON.stringify({ textures: { particle: 'block/oak_planks' } }),
    }
    const s = state('minecraft:chest', { facing: 'west', type: 'single', waterlogged: 'false' })
    const none = await new ModelResolver(new MemoryAssetReader(files)).resolve(s)
    expect(none!.parts[0]!.model.id).toBe('minecraft:chest#particle')
    const withTexture = new MemoryAssetReader({ ...files, 'assets/minecraft/textures/entity/chest/normal.png': new Uint8Array([1]) })
    const chest = await new ModelResolver(withTexture).resolve(s)
    expect(chest!.parts[0]!.model.id).toBe('minecraft:chest#chest')
    expect(chest!.parts[0]!.y).toBe(270)
  })
})
