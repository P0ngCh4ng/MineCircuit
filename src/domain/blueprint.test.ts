import { describe, expect, it } from 'vitest'
import { BlockState } from './blockState'
import { BlockVolume } from './blockVolume'
import { Blueprint } from './blueprint'
import { nbt } from './nbt'
import { ResourceLocation } from './resourceLocation'
import type { Vec3 } from './vec3'

const stone = new BlockState(ResourceLocation.parse('minecraft:stone'))
const shaft = new BlockState(ResourceLocation.parse('create:shaft'), { axis: 'x' })
const pipe = new BlockState(ResourceLocation.parse('create:fluid_pipe'))

/** blocks の位置に状態を置いたリージョンを作る */
function volume(name: string, size: Vec3, offset: Vec3, blocks: [Vec3, BlockState][]): BlockVolume {
  const palette: BlockState[] = []
  const cells = new Int32Array(size[0] * size[1] * size[2]).fill(-1)
  for (const [[x, y, z], state] of blocks) {
    let p = palette.indexOf(state)
    if (p < 0) p = palette.push(state) - 1
    cells[(y * size[2] + z) * size[0] + x] = p
  }
  return new BlockVolume({ name, size, offset, palette, cells })
}

describe('Blueprint（リージョン1つ）', () => {
  const region = new BlockVolume({
    name: 'main',
    size: [3, 2, 3],
    palette: [stone, shaft],
    cells: (() => {
      const c = new Int32Array(18).fill(-1)
      c[0] = 0 // [0,0,0]
      c[1] = 1 // [1,0,0]
      c[9 + 4] = 0 // [1,1,1]
      return c
    })(),
    blockEntities: new Map([[1, nbt.compound({ id: nbt.string('create:shaft') })]]),
  })
  const bp = new Blueprint('test.nbt', 'nbt', 2975, [region], { author: 'テスト' })

  it('ファイルの情報を持つ', () => {
    expect(bp.name).toBe('test.nbt')
    expect(bp.format).toBe('nbt')
    expect(bp.dataVersion).toBe(2975)
    expect(bp.regions).toEqual([region])
    expect(bp.meta.author).toBe('テスト')
    expect(new Blueprint('a.nbt', 'nbt', 2975, [region]).meta).toEqual({})
  })

  it('size はリージョンの大きさ', () => {
    expect(bp.size).toEqual([3, 2, 3])
  })

  it('get と blockEntityAt を設計図全体の座標で引く', () => {
    expect(bp.get([0, 0, 0])).toBe(stone)
    expect(bp.get([1, 0, 0])).toBe(shaft)
    expect(bp.get([2, 0, 0])).toBeNull()
    expect(bp.blockEntityAt([1, 0, 0])?.value.get('id')).toEqual(nbt.string('create:shaft'))
    expect(bp.blockEntityAt([0, 0, 0])).toBeNull()
  })

  it('範囲外は null を返す', () => {
    expect(bp.get([-1, 0, 0])).toBeNull()
    expect(bp.get([0, 2, 0])).toBeNull()
    expect(bp.blockEntityAt([3, 0, 0])).toBeNull()
    expect(bp.locate([0, 0, 3])).toBeNull()
  })

  it('neighbor は向きの隣を引き、範囲外は null', () => {
    expect(bp.neighbor([0, 0, 0], 'east')).toBe(shaft)
    expect(bp.neighbor([1, 0, 0], 'west')).toBe(stone)
    expect(bp.neighbor([1, 0, 1], 'up')).toBe(stone)
    expect(bp.neighbor([1, 0, 0], 'south')).toBeNull()
    expect(bp.neighbor([0, 0, 0], 'down')).toBeNull()
    expect(bp.neighbor([0, 0, 0], 'north')).toBeNull()
  })

  it('forEachInLayer はその段のブロックだけを渡す', () => {
    const seen: [Vec3, string][] = []
    bp.forEachInLayer(0, (pos, state) => seen.push([pos, state.key]))
    expect(seen).toEqual([
      [[0, 0, 0], 'minecraft:stone'],
      [[1, 0, 0], 'create:shaft[axis=x]'],
    ])
    const top: Vec3[] = []
    bp.forEachInLayer(1, (pos) => top.push(pos))
    expect(top).toEqual([[1, 1, 1]])
    bp.forEachInLayer(5, () => expect.unreachable())
    bp.forEachInLayer(-1, () => expect.unreachable())
  })

  it('namespaces は置かれているブロックの namespace', () => {
    expect(bp.namespaces).toEqual(new Set(['minecraft', 'create']))
  })

  it('namespaces はパレットに残っているだけの状態を数えない', () => {
    const r = new BlockVolume({ name: 'main', size: [1, 1, 1], palette: [pipe, stone], cells: Int32Array.of(1) })
    expect(new Blueprint('a.nbt', 'nbt', 2975, [r]).namespaces).toEqual(new Set(['minecraft']))
  })

  it('リージョンがなくても動く', () => {
    const empty = new Blueprint('empty.nbt', 'nbt', 2975, [])
    expect(empty.size).toEqual([0, 0, 0])
    expect(empty.get([0, 0, 0])).toBeNull()
    expect(empty.namespaces.size).toBe(0)
  })
})

describe('Blueprint（リージョン複数）', () => {
  // a: [0..2) × [0..1) × [0..2)、b: offset [1,0,1] から [2,2,2]
  const a = volume('a', [2, 1, 2], [0, 0, 0], [
    [[0, 0, 0], stone],
    [[1, 0, 1], stone],
  ])
  const b = volume('b', [2, 2, 2], [1, 0, 1], [
    [[0, 0, 0], pipe], // 全体の [1,0,1]。a と重なる
    [[1, 0, 1], shaft], // 全体の [2,0,2]
    [[1, 1, 1], pipe], // 全体の [2,1,2]
  ])
  const bp = new Blueprint('multi.litematic', 'litematic', 2975, [a, b])

  it('size は全リージョンを囲む大きさ', () => {
    expect(bp.size).toEqual([3, 2, 3])
  })

  it('offset を足した座標で引く', () => {
    expect(bp.get([2, 0, 2])).toBe(shaft)
    expect(bp.get([2, 1, 2])).toBe(pipe)
    expect(bp.locate([2, 1, 2])).toEqual({ region: b, local: [1, 1, 1] })
  })

  it('重なる位置は先のリージョンを優先する', () => {
    expect(bp.get([1, 0, 1])).toBe(stone)
    expect(bp.locate([1, 0, 1])?.region).toBe(a)
  })

  it('forEachInLayer は重なる位置を1回だけ渡す', () => {
    const seen: string[] = []
    bp.forEachInLayer(0, (pos, state) => seen.push(`${pos.join(',')}:${state.id.path}`))
    expect(seen).toEqual(['0,0,0:stone', '1,0,1:stone', '2,0,2:shaft'])
  })

  it('neighbor はリージョンをまたいで引く', () => {
    expect(bp.neighbor([2, 0, 2], 'up')).toBe(pipe)
  })
})
