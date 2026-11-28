import { describe, expect, it } from 'vitest'
import { blueprintFixture, state, type BlueprintFixture } from '../../tests/fixtures/blueprintFixture'
import { BlockVolume } from '../domain/blockVolume'
import { Blueprint } from '../domain/blueprint'
import type { Vec3 } from '../domain/vec3'
import { FluidField } from './fluidFlow'

const field = (fx: BlueprintFixture) => new FluidField(fx.toBlueprint())
const round = (v: Vec3) => v.map((n) => Math.round(n * 100) / 100 + 0)
const amount = (f: FluidField, pos: Vec3) => f.at(pos)?.amount ?? 0

/**
 * 床（y=0）と、まわりの壁（x・z の端）を石で囲った設計図。open の位置は空ける。
 * 設計図の外は空気なので、囲わないと液体は外へこぼれる
 */
function basin(size: Vec3, open: Vec3[] = []): BlueprintFixture {
  const skip = new Set(open.map((p) => p.join()))
  let fx = blueprintFixture().size(size)
  for (let x = 0; x < size[0]; x++) {
    for (let z = 0; z < size[2]; z++) {
      for (let y = 0; y < size[1]; y++) {
        const edge = y === 0 || x === 0 || z === 0 || x === size[0] - 1 || z === size[2] - 1
        if (edge && !skip.has([x, y, z].join())) fx = fx.place([x, y, z], 'minecraft:stone', {})
      }
    }
  }
  return fx
}

describe('液体の広がり（ST-FLUID-SPREAD）', () => {
  it('[ST-FLUID-SPREAD] level の読み方：0 とないものは水源、1〜7 は量 8 − level、8 以上は落ちる液体', () => {
    const f = field(blueprintFixture().size([1, 1, 1]).place([0, 0, 0], 'minecraft:water', {}))
    expect(f.at([0, 0, 0])).toEqual({ kind: 'water', amount: 8, source: true, falling: false })
    expect(f.simulated([0, 0, 0])).toBe(false)
    const lone = (level: string) => field(blueprintFixture().size([1, 2, 1]).place([0, 0, 0], 'minecraft:lava', { level })).at([0, 0, 0])
    expect(lone('0')).toEqual({ kind: 'lava', amount: 8, source: true, falling: false })
    expect(lone('x')).toEqual({ kind: 'lava', amount: 8, source: true, falling: false })
    // 水源のない流れる液体・落ちる液体は消える
    expect(lone('3')).toBeNull()
    expect(lone('9')).toBeNull()
    expect(field(blueprintFixture().size([1, 2, 1]).place([0, 0, 0], 'minecraft:lava', { level: '3' })).simulated([0, 0, 0])).toBe(false)
  })

  it('[ST-FLUID-SPREAD] 設計図にあった流れる液体は、水源から届くなら同じ状態のまま残る', () => {
    const f = field(basin([5, 2, 3]).place([1, 1, 1], 'minecraft:water', { level: '0' }).place([2, 1, 1], 'minecraft:water', { level: '1' }))
    expect(amount(f, [2, 1, 1])).toBe(7)
    expect(f.simulated([2, 1, 1])).toBe(false)
    expect(f.simulated([3, 1, 1])).toBe(true)
  })

  it('[ST-FLUID-SPREAD] 水は1マスごとに量が1減って広がり、量が尽きた先には届かない', () => {
    const f = field(basin([11, 2, 3]).place([1, 1, 1], 'minecraft:water', { level: '0' }))
    expect([2, 3, 8, 9].map((x) => amount(f, [x, 1, 1]))).toEqual([7, 6, 1, 0])
    expect(f.settled).toBe(true)
  })

  it('[ST-FLUID-SPREAD] 溶岩は1マスごとに2減る', () => {
    const f = field(basin([7, 2, 3]).place([1, 1, 1], 'minecraft:lava', { level: '0' }))
    expect([2, 3, 4, 5].map((x) => amount(f, [x, 1, 1]))).toEqual([6, 4, 2, 0])
  })

  it('[ST-FLUID-SPREAD] 下へ落ちられるなら落ちる。落ちた液体は量 8 で、下の床で横に広がる', () => {
    const f = field(basin([5, 3, 3]).place([1, 1, 1], 'minecraft:stone', {}).place([1, 2, 1], 'minecraft:water', { level: '0' }))
    expect(amount(f, [2, 2, 1])).toBe(7)
    expect(f.at([3, 2, 1])).toBeNull()
    expect(f.at([2, 1, 1])).toEqual({ kind: 'water', amount: 8, source: false, falling: true })
    expect(amount(f, [3, 1, 1])).toBe(7)
  })

  it('[ST-FLUID-SPREAD] 横は、4マス以内で下へ落ちられる所に近い向きだけに広がる', () => {
    // 水源 [3,1,1]。東の [5,0,1] が穴
    const f = field(basin([9, 2, 3], [[5, 0, 1]]).place([3, 1, 1], 'minecraft:water', { level: '0' }))
    expect(amount(f, [4, 1, 1])).toBe(7)
    expect(amount(f, [5, 1, 1])).toBe(6)
    expect(f.at([5, 0, 1])?.falling).toBe(true)
    expect(f.at([2, 1, 1])).toBeNull()
  })

  it('[ST-FLUID-SPREAD] 溶岩が穴を探すのは2マス先まで。見つからなければ全部の向きへ広がる', () => {
    const f = field(basin([9, 2, 3], [[7, 0, 1]]).place([3, 1, 1], 'minecraft:lava', { level: '0' }))
    expect(amount(f, [2, 1, 1])).toBe(6)
    expect(amount(f, [4, 1, 1])).toBe(6)
  })

  it('[ST-FLUID-SPREAD] 横に水源が2つあり、下が固いか水源なら水源になる。溶岩はならない', () => {
    const between = (id: string) =>
      field(basin([5, 2, 3]).place([1, 1, 1], id, { level: '0' }).place([3, 1, 1], id, { level: '0' })).at([2, 1, 1])
    expect(between('minecraft:water')?.source).toBe(true)
    expect(between('minecraft:lava')?.source).toBe(false)
    const onSource = field(
      basin([5, 3, 3])
        .place([1, 1, 1], 'minecraft:stone', {})
        .place([3, 1, 1], 'minecraft:stone', {})
        .place([2, 1, 1], 'minecraft:water', { level: '0' })
        .place([1, 2, 1], 'minecraft:water', { level: '0' })
        .place([3, 2, 1], 'minecraft:water', { level: '0' }),
    )
    expect(onSource.at([2, 2, 1])?.source).toBe(true)
  })

  it('[ST-FLUID-SPREAD] 水浸しのブロックと泡の柱は水源で、変わらずに広がる。中には液体を入れない', () => {
    const f = field(
      basin([6, 2, 3])
        .place([1, 1, 1], 'create:fluid_pipe', { waterlogged: 'true' })
        .place([4, 1, 1], 'minecraft:bubble_column', { drag: 'false' }),
    )
    expect(f.at([1, 1, 1])?.source).toBe(true)
    expect(f.at([4, 1, 1])?.source).toBe(true)
    expect(amount(f, [2, 1, 1])).toBe(7)
    expect(amount(f, [3, 1, 1])).toBe(7)
    expect(f.simulated([1, 1, 1])).toBe(false)
  })

  it('[ST-FLUID-SPREAD] 横の3つが水源の液体は、下へ落ちながら横にも広がる', () => {
    // 段 y=1 は真ん中 [2,1,2] だけ空き。段 y=2 の真ん中のまわり3方向が水源
    let fx = basin([5, 3, 5])
    for (let x = 1; x <= 3; x++) for (let z = 1; z <= 3; z++) if (x !== 2 || z !== 2) fx = fx.place([x, 1, z], 'minecraft:stone', {})
    fx = fx.place([1, 2, 2], 'minecraft:water', {}).place([3, 2, 2], 'minecraft:water', {}).place([2, 2, 1], 'minecraft:water', {})
    const f = field(fx)
    expect(f.at([2, 1, 2])?.falling).toBe(true)
    expect(amount(f, [2, 2, 3])).toBeGreaterThan(0)
  })

  it('[ST-FLUID-SPREAD] 溶岩は泡の柱に入らない', () => {
    const f = field(basin([5, 2, 3]).place([1, 1, 1], 'minecraft:lava', {}).place([2, 1, 1], 'minecraft:bubble_column', { drag: 'true' }))
    expect(f.at([2, 1, 1])?.kind).toBe('water')
    expect(f.at([3, 1, 1])?.kind).toBe('water')
  })

  it('[ST-FLUID-SPREAD] リージョンが重なる位置は、先のリージョンのブロックを使う', () => {
    const a = basin([3, 2, 3]).place([1, 1, 1], 'minecraft:water', {}).toBlueprint().regions[0]
    const b = new BlockVolume({ name: 'b', size: [1, 1, 1], offset: [1, 1, 1], palette: [state('minecraft:lava', {})], cells: Int32Array.of(0) })
    const f = new FluidField(new Blueprint('two', 'litematic', 0, [a, b]))
    expect(f.at([1, 1, 1])?.kind).toBe('water')
  })

  it('[ST-FLUID-SPREAD] 調べ直す回数の上限に届いたら、そこまでの状態で止める', () => {
    const fx = basin([11, 2, 3]).place([1, 1, 1], 'minecraft:water', {})
    expect(new FluidField(fx.toBlueprint(), 3).settled).toBe(false)
    expect(new FluidField(fx.toBlueprint()).settled).toBe(true)
  })

  it('[ST-FLUID-SPREAD] 違う液体のマスには入らない', () => {
    const f = field(basin([5, 2, 3]).place([1, 1, 1], 'minecraft:water', {}).place([3, 1, 1], 'minecraft:lava', {}))
    expect(f.at([2, 1, 1])?.kind).toBe('water')
    expect(f.at([3, 1, 1])?.kind).toBe('lava')
  })
})

describe('液体の流れの向き（ST-FLUID-FLOW）', () => {
  it('[ST-FLUID-FLOW] 量の少ない隣へ向かう。水源の両側が同じなら 0。液体のないマスは 0', () => {
    const f = field(basin([7, 2, 3]).place([3, 1, 1], 'minecraft:water', {}))
    expect(round(f.flow([4, 1, 1]))).toEqual([1, 0, 0])
    expect(round(f.flow([2, 1, 1]))).toEqual([-1, 0, 0])
    expect(round(f.flow([3, 1, 1]))).toEqual([0, 0, 0])
    expect(f.flow([0, 1, 1])).toEqual([0, 0, 0])
  })

  it('[ST-FLUID-FLOW] 隣が空きで、その下に同じ液体があれば、そちらへも向かう', () => {
    // 段 y=2 の z=1 の水路を東へ流れる水。[8,2,1]（量 1）の南 [8,2,2] は空きで、その下 [8,1,2] が水源
    const make = (below: string) => {
      let fx = basin([11, 3, 4])
      for (let x = 1; x <= 9; x++) {
        for (const z of [1, 2]) if (x !== 8 || z !== 2) fx = fx.place([x, 1, z], 'minecraft:stone', {})
        if (x !== 8) fx = fx.place([x, 2, 2], 'minecraft:stone', {})
      }
      return field(fx.place([8, 1, 2], below, {}).place([1, 2, 1], 'minecraft:water', {}))
    }
    const wet = make('minecraft:water')
    expect(amount(wet, [8, 2, 1])).toBe(1)
    expect(wet.at([8, 2, 2])).toBeNull()
    expect(round(wet.flow([8, 2, 1]))).toEqual([0.71, 0, 0.71])
    expect(round(make('minecraft:stone').flow([8, 2, 1]))).toEqual([1, 0, 0])
  })

  it('[ST-FLUID-FLOW] 違う液体の隣は数えない', () => {
    const f = field(basin([5, 2, 3]).place([1, 1, 1], 'minecraft:water', {}).place([3, 1, 1], 'minecraft:lava', {}))
    expect(f.flow([3, 1, 1])).toEqual([0, 0, 0])
  })

  it('[ST-FLUID-FLOW] 落ちる液体は、横の隣かその1つ上が固ければ下を向く', () => {
    const walled = field(basin([3, 4, 3]).place([1, 3, 1], 'minecraft:water', {}))
    expect(walled.at([1, 2, 1])?.falling).toBe(true)
    expect(round(walled.flow([1, 2, 1]))).toEqual([0, -1, 0])
    // 壁が1つ上の段だけにある
    const above = field(blueprintFixture().size([3, 4, 1]).place([1, 3, 0], 'minecraft:water', {}).place([0, 3, 0], 'minecraft:stone', {}))
    expect(round(above.flow([1, 2, 0]))).toEqual([0, -1, 0])
    // 横が空気（設計図の外）なら、横の流れ（ここでは 0）のまま
    const open = field(blueprintFixture().size([1, 4, 1]).place([0, 3, 0], 'minecraft:water', {}))
    expect(open.at([0, 2, 0])?.falling).toBe(true)
    expect(open.flow([0, 2, 0])).toEqual([0, 0, 0])
    // 同じ液体を持つ水浸しのブロックは、受け止める面に数えない
    const logged = field(blueprintFixture().size([2, 4, 1]).place([0, 3, 0], 'minecraft:water', {}).place([1, 2, 0], 'create:fluid_pipe', { waterlogged: 'true' }))
    expect(logged.flow([0, 2, 0])[1]).toBeGreaterThan(-1)
  })
})
