import { describe, expect, it } from 'vitest'
import { BlockState } from './blockState'
import { BlockVolume, EMPTY_CELL, cellIndex } from './blockVolume'
import { nbt } from './nbt'
import { ResourceLocation } from './resourceLocation'

const stone = new BlockState(ResourceLocation.parse('minecraft:stone'))
const shaftY = new BlockState(ResourceLocation.parse('create:shaft'), { axis: 'y' })
const shaftX = new BlockState(ResourceLocation.parse('create:shaft'), { axis: 'x' })

describe('cellIndex', () => {
  it('x が内側、次に z、外側が y の順に並ぶ', () => {
    const size = [2, 3, 4] as const
    expect(cellIndex(size, 0, 0, 0)).toBe(0)
    expect(cellIndex(size, 1, 0, 0)).toBe(1)
    expect(cellIndex(size, 0, 0, 1)).toBe(2)
    expect(cellIndex(size, 0, 1, 0)).toBe(8)
    expect(cellIndex(size, 1, 2, 3)).toBe(23)
  })

  it('範囲外と整数でない座標は -1', () => {
    const size = [2, 2, 2] as const
    expect(cellIndex(size, -1, 0, 0)).toBe(-1)
    expect(cellIndex(size, 2, 0, 0)).toBe(-1)
    expect(cellIndex(size, 0, 2, 0)).toBe(-1)
    expect(cellIndex(size, 0, 0, 2)).toBe(-1)
    expect(cellIndex(size, 0.5, 0, 0)).toBe(-1)
  })
})

describe('BlockVolume', () => {
  function makeVolume(): BlockVolume {
    const size = [2, 2, 2] as const
    const cells = new Int32Array(8).fill(-1)
    cells[cellIndex(size, 0, 0, 0)] = 0
    cells[cellIndex(size, 1, 1, 1)] = 1
    const be = nbt.compound({ id: nbt.string('create:shaft'), Speed: nbt.float(16) })
    return new BlockVolume({
      name: 'main',
      size,
      palette: [stone, shaftY],
      cells,
      blockEntities: new Map([[cellIndex(size, 1, 1, 1), be]]),
      entities: [nbt.compound({ id: nbt.string('minecraft:item_frame') })],
      extra: nbt.compound({ Railways_DataVersion: nbt.int(3) }),
    })
  }

  it('省略した項目は既定値になり、すべて空き', () => {
    const v = new BlockVolume({ name: 'main', size: [1, 2, 3] })
    expect(v.offset).toEqual([0, 0, 0])
    expect(v.palette).toEqual([])
    expect(v.entities).toEqual([])
    expect(v.extra.value.size).toBe(0)
    expect(v.get(0, 1, 2)).toBeNull()
    expect(v.cellAt(0, 1, 2)).toEqual(EMPTY_CELL)
  })

  it('get で状態を、blockEntityAt で生データを引ける', () => {
    const v = makeVolume()
    expect(v.get(0, 0, 0)).toBe(stone)
    expect(v.get(1, 1, 1)).toBe(shaftY)
    expect(v.get(1, 0, 0)).toBeNull()
    expect(v.blockEntityAt(0, 0, 0)).toBeNull()
    expect(v.blockEntityAt(1, 1, 1)?.value.get('id')).toEqual(nbt.string('create:shaft'))
  })

  it('エンティティと extra をそのまま持つ', () => {
    const v = makeVolume()
    expect(v.entities).toHaveLength(1)
    expect(v.extra.value.get('Railways_DataVersion')).toEqual(nbt.int(3))
  })

  it('範囲外は null を返す', () => {
    const v = makeVolume()
    for (const [x, y, z] of [[-1, 0, 0], [2, 0, 0], [0, -1, 0], [0, 2, 0], [0, 0, -1], [0, 0, 2]]) {
      expect(v.contains(x, y, z)).toBe(false)
      expect(v.get(x, y, z)).toBeNull()
      expect(v.blockEntityAt(x, y, z)).toBeNull()
      expect(v.cellAt(x, y, z)).toBeNull()
    }
  })

  it('cellAt は状態と生データを合わせて返す', () => {
    const v = makeVolume()
    const cell = v.cellAt(1, 1, 1)
    expect(cell?.state).toBe(shaftY)
    expect(cell?.blockEntity).toBe(v.blockEntityAt(1, 1, 1))
    expect(v.cellAt(0, 0, 0)).toEqual({ state: stone, blockEntity: null })
  })

  it('forEachBlock は空きでないマスを段ごとの順に渡す', () => {
    const v = makeVolume()
    const seen: string[] = []
    v.forEachBlock((x, y, z, state, be) => seen.push(`${x},${y},${z}:${state.key}:${be ? 'be' : '-'}`))
    expect(seen).toEqual(['0,0,0:minecraft:stone:-', '1,1,1:create:shaft[axis=y]:be'])
  })

  it('stateIndex はパレットにあればその番号、なければ末尾に足す', () => {
    const v = makeVolume()
    expect(v.stateIndex(new BlockState(ResourceLocation.parse('create:shaft'), { axis: 'y' }))).toBe(1)
    expect(v.stateIndex(shaftX)).toBe(2)
    expect(v.stateIndex(shaftX)).toBe(2)
    expect(v.palette).toEqual([stone, shaftY, shaftX])
  })

  it('setCell で状態と生データを書き換え、cellAt で読み戻せる', () => {
    const v = makeVolume()
    const be = nbt.compound({ id: nbt.string('create:shaft') })
    v.setCell(1, 0, 0, { state: shaftX, blockEntity: be })
    expect(v.cellAt(1, 0, 0)).toEqual({ state: shaftX, blockEntity: be })
    expect(v.palette).toContain(shaftX)

    // 生データなしで置き直すと、生データは消える
    v.setCell(1, 0, 0, { state: stone, blockEntity: null })
    expect(v.cellAt(1, 0, 0)).toEqual({ state: stone, blockEntity: null })

    // 空きにすると生データも消える
    v.setCell(1, 1, 1, EMPTY_CELL)
    expect(v.get(1, 1, 1)).toBeNull()
    expect(v.blockEntityAt(1, 1, 1)).toBeNull()
    // 使われなくなった状態もパレットには残る
    expect(v.palette).toContain(shaftY)
  })

  it('setCell の前の cellAt を書き戻すと元に戻る', () => {
    const v = makeVolume()
    const before = v.cellAt(1, 1, 1)!
    v.setCell(1, 1, 1, { state: stone, blockEntity: null })
    v.setCell(1, 1, 1, before)
    expect(v.cellAt(1, 1, 1)).toEqual(before)
    expect(v.blockEntityAt(1, 1, 1)).toBe(before.blockEntity)
  })

  it('setCell は範囲外でエラーになる', () => {
    const v = makeVolume()
    expect(() => v.setCell(2, 0, 0, { state: stone, blockEntity: null })).toThrow()
  })

  it('材料が合わないときはエラーになる', () => {
    expect(() => new BlockVolume({ name: 'main', size: [-1, 1, 1] })).toThrow()
    expect(() => new BlockVolume({ name: 'main', size: [2, 1, 1], cells: new Int32Array(3) })).toThrow()
    expect(() => new BlockVolume({ name: 'main', size: [1, 1, 1], cells: Int32Array.of(0) })).toThrow()
    expect(
      () => new BlockVolume({ name: 'main', size: [1, 1, 1], blockEntities: new Map([[1, nbt.compound()]]) }),
    ).toThrow()
  })
})
