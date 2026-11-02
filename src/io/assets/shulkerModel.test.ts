import { describe, expect, it } from 'vitest'
import { BlockState } from '../../domain/blockState'
import { ResourceLocation } from '../../domain/resourceLocation'
import { shulkerAppearance } from './shulkerModel'

const state = (id: string, props: Record<string, string> = {}) => new BlockState(ResourceLocation.parse(id), props)

describe('shulkerAppearance（#221）', () => {
  it('色なしと16色。ほかのブロックは null', () => {
    expect(shulkerAppearance(state('minecraft:shulker_box'))?.texturePath).toBe('assets/minecraft/textures/entity/shulker/shulker.png')
    expect(shulkerAppearance(state('minecraft:light_blue_shulker_box'))?.texturePath).toBe(
      'assets/minecraft/textures/entity/shulker/shulker_light_blue.png',
    )
    expect(shulkerAppearance(state('minecraft:chest'))).toBeNull()
    expect(shulkerAppearance(state('test:red_shulker_box'))).toBeNull()
  })

  it('本体 0〜8 とふた 4〜16 の2つの要素。帯は上下を返さない。ふたを facing に向ける', () => {
    const part = shulkerAppearance(state('minecraft:red_shulker_box', { facing: 'west' }))!.appearance.parts[0]!
    expect([part.x, part.y]).toEqual([90, 270])
    const [base, lid] = part.model.elements
    expect([base!.from, base!.to, lid!.from, lid!.to]).toEqual([[0, 0, 0], [16, 8, 16], [0, 4, 0], [16, 16, 16]])
    // 西の面は u 0〜16。ふたの帯は v 16〜28、本体の帯は v 44〜52（64 ピクセル → 16）
    expect(lid!.faces.west).toMatchObject({ texture: 'minecraft:entity/shulker/shulker_red', uv: [0, 4, 4, 7], cullface: 'west' })
    expect(base!.faces.west!.uv).toEqual([0, 11, 4, 13])
    expect(lid!.faces.up!.uv).toEqual([4, 0, 8, 4])
    expect(base!.faces.down!.uv).toEqual([8, 7, 12, 11])
    expect(shulkerAppearance(state('minecraft:shulker_box', { facing: 'down' }))!.appearance.parts[0]!.x).toBe(180)
    expect(shulkerAppearance(state('minecraft:shulker_box', {}))!.appearance.parts[0]!.x).toBe(0)
  })
})
