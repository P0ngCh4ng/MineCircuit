import { describe, expect, it } from 'vitest'
import { Blueprint } from '../domain/blueprint'
import { BlockVolume } from '../domain/blockVolume'
import { nbt } from '../domain/nbt'
import { blueprintFixture, entityNbt, state } from '../../tests/fixtures/blueprintFixture'
import { BlueprintStats } from './blueprintStats'

function sample() {
  return blueprintFixture({ size: [4, 3, 3] })
    .place([0, 0, 0], 'create:shaft', { axis: 'x' })
    .place([1, 0, 0], 'create:shaft', { axis: 'z' })
    .place([2, 0, 0], 'create:creative_motor', nbt.compound({ Speed: nbt.int(64) }))
    .fill([0, 1, 0], [1, 1, 1], 'minecraft:stone')
    .place([3, 1, 2], 'create:shaft', { axis: 'y' })
    .entity(entityNbt([0, 1, 0], 'minecraft:item_frame'))
    .toBlueprint()
}

describe('BlueprintStats', () => {
  it('countAll は ID ごとの数を、多い順・同じなら ID の順で返す（properties は区別しない）', () => {
    const stats = new BlueprintStats(sample())
    expect([...stats.countAll()]).toEqual([
      ['minecraft:stone', 4],
      ['create:shaft', 3],
      ['create:creative_motor', 1],
    ])
  })

  it('countLayer は段 y だけを数える。範囲外の段は空', () => {
    const stats = new BlueprintStats(sample())
    expect([...stats.countLayer(0)]).toEqual([
      ['create:shaft', 2],
      ['create:creative_motor', 1],
    ])
    expect([...stats.countLayer(1)]).toEqual([
      ['minecraft:stone', 4],
      ['create:shaft', 1],
    ])
    expect(stats.countLayer(2).size).toBe(0)
    expect(stats.countLayer(-1).size).toBe(0)
    expect(stats.countLayer(3).size).toBe(0)
  })

  it('bounds はブロックのあるマスの範囲を返す（max も含む）', () => {
    expect(new BlueprintStats(sample()).bounds()).toEqual({ min: [0, 0, 0], max: [3, 1, 2] })
    const bp = blueprintFixture({ size: [5, 5, 5] }).place([2, 3, 1], 'minecraft:stone').toBlueprint()
    expect(new BlueprintStats(bp).bounds()).toEqual({ min: [2, 3, 1], max: [2, 3, 1] })
  })

  it('ブロックが1つもなければ、数は空で bounds は null', () => {
    const stats = new BlueprintStats(blueprintFixture({ size: [2, 2, 2] }).toBlueprint())
    expect(stats.countAll().size).toBe(0)
    expect(stats.bounds()).toBeNull()
    expect(stats.totals()).toEqual({ blockCount: 0, kindCount: 0, blockEntityCount: 0, entityCount: 0 })
  })

  it('totals はブロック数・種類・nbt 付き・エンティティを数える', () => {
    expect(new BlueprintStats(sample()).totals()).toEqual({
      blockCount: 8,
      kindCount: 3,
      blockEntityCount: 1,
      entityCount: 1,
    })
  })

  it('空気は数えない', () => {
    const air = state('minecraft:air')
    const stone = state('minecraft:stone')
    const region = new BlockVolume({ name: 'main', size: [2, 1, 1], palette: [air, stone], cells: new Int32Array([0, 1]) })
    const stats = new BlueprintStats(new Blueprint('x.litematic', 'litematic', 3465, [region]))
    expect([...stats.countAll()]).toEqual([['minecraft:stone', 1]])
    expect([...stats.countLayer(0)]).toEqual([['minecraft:stone', 1]])
    expect(stats.bounds()).toEqual({ min: [1, 0, 0], max: [1, 0, 0] })
  })

  it('リージョンが重なる位置は先のリージョンだけを数え、offset を全体の座標に足す', () => {
    const stone = state('minecraft:stone')
    const dirt = state('minecraft:dirt')
    const a = new BlockVolume({ name: 'a', size: [2, 1, 1], palette: [stone], cells: new Int32Array([0, 0]) })
    const b = new BlockVolume({ name: 'b', size: [2, 1, 1], offset: [1, 2, 0], palette: [dirt], cells: new Int32Array([0, 0]) })
    const c = new BlockVolume({ name: 'c', size: [2, 1, 1], offset: [1, 0, 0], palette: [dirt], cells: new Int32Array([0, 0]) })
    const stats = new BlueprintStats(new Blueprint('x.litematic', 'litematic', 3465, [a, b, c]))
    expect([...stats.countAll()]).toEqual([
      ['minecraft:dirt', 3],
      ['minecraft:stone', 2],
    ])
    expect([...stats.countLayer(0)]).toEqual([
      ['minecraft:stone', 2],
      ['minecraft:dirt', 1],
    ])
    expect([...stats.countLayer(2)]).toEqual([['minecraft:dirt', 2]])
    expect(stats.bounds()).toEqual({ min: [0, 0, 0], max: [2, 2, 0] })
    expect(stats.totals().blockCount).toBe(5)
  })

  it('countAll の結果を書き換えても、次の結果は変わらない', () => {
    const stats = new BlueprintStats(sample())
    stats.countAll().clear()
    expect(stats.countAll().size).toBe(3)
  })
})
