import { describe, expect, it } from 'vitest'
import { Blueprint } from '../../domain/blueprint'
import { BlockVolume } from '../../domain/blockVolume'
import { nbt } from '../../domain/nbt'
import { blueprintFixture, entityNbt, state } from '../../../tests/fixtures/blueprintFixture'
import { minecraftVersionLabel, summarizeBlueprint } from './blueprintSummary'

describe('summarizeBlueprint', () => {
  it('寸法、ブロック数、種類、nbt 付き、エンティティ、バージョンを数える', () => {
    const bp = blueprintFixture({ size: [4, 2, 3], dataVersion: 2975 })
      .place([0, 0, 0], 'create:shaft', { axis: 'x' })
      .place([1, 0, 0], 'create:shaft', { axis: 'z' })
      .place([2, 0, 0], 'create:creative_motor', nbt.compound({ Speed: nbt.int(64) }))
      .fill([0, 1, 0], [1, 1, 1], 'minecraft:stone')
      .entity(entityNbt([0, 1, 0], 'minecraft:item_frame'))
      .toBlueprint()

    expect(summarizeBlueprint(bp)).toEqual({
      size: [4, 2, 3],
      blockCount: 7,
      kindCount: 3,
      blockEntityCount: 1,
      entityCount: 1,
      dataVersion: 2975,
    })
  })

  it('リージョンが重なる位置は1回だけ数える', () => {
    const stone = state('minecraft:stone')
    const full = (name: string, offset: readonly [number, number, number]) =>
      new BlockVolume({ name, size: [2, 1, 1], offset, palette: [stone], cells: new Int32Array([0, 0]) })
    const bp = new Blueprint('x.litematic', 'litematic', 3465, [full('a', [0, 0, 0]), full('b', [1, 0, 0])])
    expect(summarizeBlueprint(bp).blockCount).toBe(3)
  })
})

describe('minecraftVersionLabel', () => {
  it('DataVersion からおよそのバージョンを出す', () => {
    expect(minecraftVersionLabel(2975)).toBe('約 1.18.2（2975）')
    expect(minecraftVersionLabel(3466)).toBe('約 1.20.1（3466）')
    expect(minecraftVersionLabel(1343)).toBe('1.16.5 より前（1343）')
    expect(minecraftVersionLabel(0)).toBe('不明')
  })
})
