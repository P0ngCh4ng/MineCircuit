import { describe, expect, it } from 'vitest'
import { createEmptyBlueprint, NEW_BLUEPRINT_MAX_SIDE, normalizeBlueprintName, validateNewBlueprint } from './newBlueprint'
import { findMinecraftVersion, MINECRAFT_VERSIONS, minecraftVersionOf } from './minecraftVersion'

describe('createEmptyBlueprint', () => {
  it('指定した大きさの空の .nbt を作る', () => {
    const bp = createEmptyBlueprint({ name: '水車', size: [4, 3, 5], dataVersion: 3465 })
    expect(bp.name).toBe('水車.nbt')
    expect(bp.format).toBe('nbt')
    expect(bp.dataVersion).toBe(3465)
    expect(bp.size).toEqual([4, 3, 5])
    expect(bp.regions).toHaveLength(1)
    const region = bp.regions[0]
    expect(region.name).toBe('main')
    expect(region.palette).toEqual([])
    expect(region.entities).toEqual([])
    expect(region.extra.value.size).toBe(0)
    let blocks = 0
    region.forEachBlock(() => blocks++)
    expect(blocks).toBe(0)
  })

  it('名前の .nbt と前後の空白を取る', () => {
    expect(createEmptyBlueprint({ name: '  mill.NBT ', size: [1, 1, 1], dataVersion: 2975 }).name).toBe('mill.nbt')
  })

  it('正しくない材料ではエラーを投げる', () => {
    expect(() => createEmptyBlueprint({ name: 'a', size: [0, 1, 1], dataVersion: 2975 })).toThrow(/幅は 1 から/)
  })
})

describe('validateNewBlueprint', () => {
  it('正しければ空', () => {
    expect(validateNewBlueprint({ name: 'a', size: [1, NEW_BLUEPRINT_MAX_SIDE, 16], dataVersion: 2975 })).toEqual([])
  })

  it('名前・大きさ・バージョンの間違いをすべて返す', () => {
    const errors = validateNewBlueprint({ name: ' ', size: [1.5, 0, NEW_BLUEPRINT_MAX_SIDE + 1], dataVersion: 0 })
    expect(errors).toEqual([
      '名前を入れてください。',
      '幅は 1 から 256 までの整数にしてください。',
      '高さは 1 から 256 までの整数にしてください。',
      '奥行きは 1 から 256 までの整数にしてください。',
      'Minecraft のバージョンを選んでください。',
    ])
  })
})

describe('normalizeBlueprintName', () => {
  it('ファイル名に使えない文字を _ にする', () => {
    expect(normalizeBlueprintName('a/b:c?.nbt')).toBe('a_b_c_')
  })
})

describe('minecraftVersion', () => {
  it('名前と DataVersion から探す', () => {
    expect(findMinecraftVersion('1.18.2')?.dataVersion).toBe(2975)
    expect(findMinecraftVersion('1.99')).toBeNull()
    expect(minecraftVersionOf(3466)?.name).toBe('1.20.1')
    expect(minecraftVersionOf(100)).toBeNull()
  })

  it('一覧は古い順', () => {
    const values = MINECRAFT_VERSIONS.map((v) => v.dataVersion)
    expect([...values].sort((a, b) => a - b)).toEqual(values)
  })
})
