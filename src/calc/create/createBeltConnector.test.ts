import { describe, expect, it } from 'vitest'
import { blueprintContents, blueprintFixture, type BlueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { BlockState } from '../../domain/blockState'
import { Blueprint } from '../../domain/blueprint'
import { BlockVolume } from '../../domain/blockVolume'
import { nbt, type RawNbt } from '../../domain/nbt'
import { ResourceLocation } from '../../domain/resourceLocation'
import type { Vec3 } from '../../domain/vec3'
import { replaceCells } from '../../edit/editCommand'
import { EditHistory } from '../../edit/editHistory'
import type { VirtualPort } from '../virtualPort'
import { beltConnectionProblem, beltShaftAxis, planBeltConnection, type BeltPlan } from './createBeltConnector'
import { runCreateStress } from './createStressPlugin'

const shaft = (fx: BlueprintFixture, pos: Vec3, axis: string): BlueprintFixture => fx.place(pos, 'create:shaft', { axis })

function plan(bp: Blueprint, a: Vec3, b: Vec3, options = {}): BeltPlan {
  const p = planBeltConnection(bp, a, b, options)
  if (p === null || typeof p === 'string') throw new Error(`つなげない: ${p}`)
  return p
}

/** 区間ごとの「位置 → ブロック状態」 */
const keys = (p: BeltPlan) => p.segments.map((s) => `${s.pos.join(',')} ${s.after.state?.key}`)

function connect(bp: Blueprint, a: Vec3, b: Vec3): EditHistory {
  const history = new EditHistory(bp)
  const cmd = replaceCells(bp, plan(bp, a, b).segments, 'ベルトをつなぐ')
  if (!cmd) throw new Error('変化なし')
  history.apply(cmd)
  return history
}

const tag = (be: RawNbt | null, key: string) => be?.value.get(key)

describe('ベルトをつなげるか（#248）', () => {
  it('[PL-BELT-SHAFT] ベルトを掛けられるのはシャフトだけ。ケース入りのシャフトや歯車は選べない', () => {
    const bp = shaft(blueprintFixture({ size: [5, 1, 1] }), [0, 0, 0], 'z')
      .place([2, 0, 0], 'create:cogwheel', { axis: 'z' })
      .place([4, 0, 0], 'create:andesite_encased_shaft', { axis: 'z' })
      .toBlueprint()
    expect(beltShaftAxis(bp.get([0, 0, 0]))).toBe('z')
    expect(beltShaftAxis(bp.get([2, 0, 0]))).toBeNull()
    expect(beltConnectionProblem(bp, [0, 0, 0], [2, 0, 0])).toContain('シャフトだけ')
    expect(beltConnectionProblem(bp, [0, 0, 0], [4, 0, 0])).toContain('シャフトだけ')
    expect(beltConnectionProblem(bp, [0, 0, 0], [1, 0, 0])).toContain('シャフトだけ')
  })

  it('[PL-BELT-LENGTH] 2本の距離が上限（初期値 20）より短いこと。ちょうど 20 はつなげない', () => {
    let fx = blueprintFixture({ size: [21, 1, 1] })
    for (const x of [0, 19, 20]) fx = shaft(fx, [x, 0, 0], 'z')
    const bp = fx.toBlueprint()
    expect(beltConnectionProblem(bp, [0, 0, 0], [19, 0, 0])).toBeNull()
    expect(beltConnectionProblem(bp, [0, 0, 0], [20, 0, 0])).toContain('長すぎ')
    expect(beltConnectionProblem(bp, [0, 0, 0], [19, 0, 0], { maxLength: 19 })).toContain('19 マス')
  })

  it('[PL-BELT-AXIS] 2本の軸の向きが同じで、軸の向きにずれていないこと', () => {
    const bp = shaft(shaft(shaft(blueprintFixture({ size: [4, 1, 2] }), [0, 0, 0], 'z'), [3, 0, 0], 'x'), [3, 0, 1], 'z').toBlueprint()
    expect(beltConnectionProblem(bp, [0, 0, 0], [3, 0, 0])).toContain('軸の向きが違います')
    expect(beltConnectionProblem(bp, [0, 0, 0], [3, 0, 1])).toContain('軸の向きにずれています')
  })

  it('[PL-BELT-LINE] まっすぐか 45 度の斜めだけ。縦のシャフトは水平にまっすぐだけ', () => {
    let fx = blueprintFixture({ size: [4, 4, 4] })
    for (const p of [[0, 0, 0], [3, 3, 0], [3, 1, 0], [0, 3, 0]] as Vec3[]) fx = shaft(fx, p, 'z')
    for (const p of [[0, 0, 3], [3, 0, 3], [3, 0, 0]] as Vec3[]) fx = fx.place(p, 'create:shaft', { axis: p[2] === 0 ? 'z' : 'y' })
    fx = shaft(fx, [0, 1, 2], 'y').place([3, 1, 3], 'create:shaft', { axis: 'y' })
    const bp = fx.toBlueprint()
    expect(beltConnectionProblem(bp, [0, 0, 0], [3, 3, 0])).toBeNull()
    expect(beltConnectionProblem(bp, [0, 0, 0], [0, 3, 0])).toBeNull()
    expect(beltConnectionProblem(bp, [0, 0, 0], [3, 1, 0])).toContain('45 度')
    expect(beltConnectionProblem(bp, [0, 0, 3], [3, 0, 3])).toBeNull()
    // 縦のシャフトどうしの斜め（x・z の両方がずれる）はつなげない
    expect(beltConnectionProblem(bp, [0, 1, 2], [3, 1, 3])).toContain('縦のシャフト')
  })

  it('[PL-BELT-SPEED] 回転数が分かっていて、符号が逆ならつなげない。止まっているときと分からないときはつなげる', () => {
    const bp = shaft(shaft(blueprintFixture({ size: [3, 1, 1] }), [0, 0, 0], 'z'), [2, 0, 0], 'z').toBlueprint()
    const speeds = (a: number | null, b: number | null) => ({ speedAt: (p: Vec3) => (p[0] === 0 ? a : b) })
    expect(beltConnectionProblem(bp, [0, 0, 0], [2, 0, 0], speeds(16, -16))).toContain('逆向き')
    expect(beltConnectionProblem(bp, [0, 0, 0], [2, 0, 0], speeds(16, 32))).toBeNull()
    expect(beltConnectionProblem(bp, [0, 0, 0], [2, 0, 0], speeds(16, 0))).toBeNull()
    expect(beltConnectionProblem(bp, [0, 0, 0], [2, 0, 0], speeds(-8, null))).toBeNull()
  })

  it('[PL-BELT-BETWEEN] 間のマスは、同じ軸のシャフトか置き換えられるブロック（空気・水・草など）だけ', () => {
    const fx = () => shaft(shaft(blueprintFixture({ size: [4, 1, 1] }), [0, 0, 0], 'z'), [3, 0, 0], 'z')
    expect(beltConnectionProblem(fx().place([1, 0, 0], 'minecraft:water', { level: '0' }).place([2, 0, 0], 'minecraft:short_grass').toBlueprint(), [0, 0, 0], [3, 0, 0])).toBeNull()
    expect(beltConnectionProblem(shaft(fx(), [1, 0, 0], 'z').toBlueprint(), [0, 0, 0], [3, 0, 0])).toBeNull()
    expect(beltConnectionProblem(shaft(fx(), [1, 0, 0], 'x').toBlueprint(), [0, 0, 0], [3, 0, 0])).toContain('(1, 0, 0) にブロック')
    expect(beltConnectionProblem(fx().place([2, 0, 0], 'minecraft:stone').toBlueprint(), [0, 0, 0], [3, 0, 0])).toContain('(2, 0, 0) にブロック')
  })

  it('[PL-BELT-SAME] 同じシャフトを2回選んだときは、何もしない', () => {
    const bp = shaft(blueprintFixture({ size: [1, 1, 1] }), [0, 0, 0], 'z').toBlueprint()
    expect(planBeltConnection(bp, [0, 0, 0], [0, 0, 0])).toBeNull()
  })
})

describe('敷くベルト（#248）', () => {
  it('[PL-BELT-FACING][PL-BELT-SLOPE][PL-BELT-PART] 水平：1本目から2本目へ向き、両端のシャフトが start・end、間は middle', () => {
    const bp = shaft(shaft(blueprintFixture({ size: [4, 1, 1] }), [3, 0, 0], 'z'), [0, 0, 0], 'z').toBlueprint()
    expect(keys(plan(bp, [3, 0, 0], [0, 0, 0]))).toEqual([
      '3,0,0 create:belt[casing=false,facing=west,part=start,slope=horizontal,waterlogged=false]',
      '2,0,0 create:belt[casing=false,facing=west,part=middle,slope=horizontal,waterlogged=false]',
      '1,0,0 create:belt[casing=false,facing=west,part=middle,slope=horizontal,waterlogged=false]',
      '0,0,0 create:belt[casing=false,facing=west,part=end,slope=horizontal,waterlogged=false]',
    ])
  })

  it('[PL-BELT-PART] 間にある同じ軸のシャフトは pulley になる', () => {
    const bp = shaft(shaft(shaft(blueprintFixture({ size: [1, 1, 3] }), [0, 0, 0], 'x'), [0, 0, 1], 'x'), [0, 0, 2], 'x').toBlueprint()
    expect(plan(bp, [0, 0, 0], [0, 0, 2]).segments.map((s) => `${s.after.state?.properties['facing']} ${s.after.state?.properties['part']}`)).toEqual([
      'south start',
      'south pulley',
      'south end',
    ])
  })

  it('[PL-BELT-SLOPE][PL-BELT-FACING] 斜め：upward・downward で、向きは水平に進む向き', () => {
    const bp = shaft(shaft(blueprintFixture({ size: [1, 3, 3] }), [0, 0, 0], 'x'), [0, 2, 2], 'x').toBlueprint()
    const up = plan(bp, [0, 0, 0], [0, 2, 2])
    expect(up.segments.map((s) => s.pos)).toEqual([[0, 0, 0], [0, 1, 1], [0, 2, 2]])
    expect(up.segments.every((s) => s.after.state?.properties['slope'] === 'upward' && s.after.state.properties['facing'] === 'south')).toBe(true)
    const down = plan(bp, [0, 2, 2], [0, 0, 0])
    expect(down.segments.every((s) => s.after.state?.properties['slope'] === 'downward' && s.after.state.properties['facing'] === 'north')).toBe(true)
  })

  it('[PL-BELT-SLOPE][PL-BELT-FACING] 縦：vertical で、向きはシャフトに垂直な水平の軸の、上へなら正・下へなら負の向き', () => {
    const fx = shaft(shaft(shaft(shaft(blueprintFixture({ size: [2, 3, 1] }), [0, 0, 0], 'x'), [0, 2, 0], 'x'), [1, 0, 0], 'z'), [1, 2, 0], 'z')
    const bp = fx.toBlueprint()
    const facing = (a: Vec3, b: Vec3) => [...new Set(plan(bp, a, b).segments.map((s) => `${s.after.state?.properties['slope']} ${s.after.state?.properties['facing']}`))]
    expect(facing([0, 0, 0], [0, 2, 0])).toEqual(['vertical south'])
    expect(facing([0, 2, 0], [0, 0, 0])).toEqual(['vertical north'])
    expect(facing([1, 0, 0], [1, 2, 0])).toEqual(['vertical east'])
    expect(facing([1, 2, 0], [1, 0, 0])).toEqual(['vertical west'])
    expect(plan(bp, [0, 0, 0], [0, 2, 0]).segments.map((s) => s.pos)).toEqual([[0, 0, 0], [0, 1, 0], [0, 2, 0]])
  })

  it('[PL-BELT-SLOPE] 縦のシャフトに掛けたベルトは sideways', () => {
    const bp = shaft(shaft(blueprintFixture({ size: [1, 1, 3] }), [0, 0, 0], 'y'), [0, 0, 2], 'y').toBlueprint()
    expect(new Set(plan(bp, [0, 0, 2], [0, 0, 0]).segments.map((s) => `${s.after.state?.properties['slope']} ${s.after.state?.properties['facing']}`))).toEqual(
      new Set(['sideways north']),
    )
  })

  it('[PL-BELT-WATER] 水の源と、水に浸かったシャフトの所の区間は waterlogged=true', () => {
    const bp = blueprintFixture({ size: [4, 1, 1] })
      .place([0, 0, 0], 'create:shaft', { axis: 'z', waterlogged: 'true' })
      .place([1, 0, 0], 'minecraft:water', { level: '0' })
      .place([2, 0, 0], 'minecraft:water', { level: '3' })
      .place([3, 0, 0], 'create:shaft', { axis: 'z', waterlogged: 'false' })
      .toBlueprint()
    expect(plan(bp, [0, 0, 0], [3, 0, 0]).segments.map((s) => s.after.state?.properties['waterlogged'])).toEqual(['true', 'true', 'false', 'false'])
  })

  it('[PL-BELT-NBT][PL-BELT-NBT-ORIGIN] 生データ：Controller は始めの区間の設計図の中の位置、Length・Index・IsController・Casing・Covered', () => {
    const fx = (dataVersion: number) => shaft(shaft(blueprintFixture({ size: [3, 1, 1], dataVersion }), [2, 0, 0], 'z'), [0, 0, 0], 'z').toBlueprint()
    const old = plan(fx(2975), [2, 0, 0], [0, 0, 0]).segments
    expect(old.map((s) => [tag(s.after.blockEntity, 'Index')?.value, tag(s.after.blockEntity, 'IsController')?.value])).toEqual([
      [0, 1],
      [1, 0],
      [2, 0],
    ])
    const first = old[1]!.after.blockEntity!
    expect(tag(first, 'id')).toEqual(nbt.string('create:belt'))
    expect(tag(first, 'Length')).toEqual(nbt.int(3))
    expect(tag(first, 'Casing')).toEqual(nbt.string('NONE'))
    expect(tag(first, 'Covered')).toEqual(nbt.byte(0))
    expect(tag(first, 'Controller')).toEqual(nbt.compound({ X: nbt.int(2), Y: nbt.int(0), Z: nbt.int(0) }))
    // 1.20.5 から位置は int 配列
    expect(tag(plan(fx(3953), [2, 0, 0], [0, 0, 0]).segments[0]!.after.blockEntity, 'Controller')).toEqual(nbt.intArray([2, 0, 0]))
  })

  it('元に戻すと完全に元の状態になり、やり直すと同じベルトになる', () => {
    const bp = blueprintFixture({ size: [4, 1, 1] })
      .place([0, 0, 0], 'create:shaft', { axis: 'z' }, nbt.compound({ id: nbt.string('create:simple_kinetic'), Speed: nbt.float(8) }))
      .place([1, 0, 0], 'minecraft:water', { level: '0' })
      .place([3, 0, 0], 'create:shaft', { axis: 'z' })
      .toBlueprint()
    const before = blueprintContents(bp)
    const history = connect(bp, [0, 0, 0], [3, 0, 0])
    const after = blueprintContents(bp)
    expect(after).not.toEqual(before)
    history.undo()
    expect(blueprintContents(bp)).toEqual(before)
    history.redo()
    expect(blueprintContents(bp)).toEqual(after)
  })

  it('間のマスが設計図の外（リージョンのすき間）なら、何も変えない', () => {
    const bp = shaft(shaft(blueprintFixture({ size: [3, 1, 1] }), [0, 0, 0], 'z'), [2, 0, 0], 'z').toBlueprint()
    expect(replaceCells(bp, [{ pos: [9, 0, 0], after: { state: null, blockEntity: null } }], 'x')).toBeNull()
  })
})

describe('つないだベルトを計算に通す（#248）', () => {
  // モーター → シャフト A（[1,0,1]）= ベルト = シャフト B（[4,0,1]）→ 先のシャフト（[4,0,2]）。物の入口は 2 マス目
  const line = () =>
    shaft(shaft(shaft(blueprintFixture({ size: [6, 1, 3] }), [1, 0, 1], 'z'), [4, 0, 1], 'z'), [4, 0, 2], 'z')
      .place([1, 0, 0], 'create:creative_motor', { facing: 'south' }, nbt.compound({ ScrollValue: nbt.int(16) }))
      .place([0, 0, 1], 'minecraft:barrel', { facing: 'up', open: 'false' })
      .place([5, 0, 1], 'minecraft:barrel', { facing: 'up', open: 'false' })
      .toBlueprint()
  const input: VirtualPort = { id: 'p1', pos: [2, 0, 1], pluginId: 'create-stress', kind: 'item-input', params: { rate: 1 }, items: { item: 'minecraft:stone' } }

  it('ベルトでつないだ先のシャフトも同じ回転数で回り、物はベルトを通って端の樽へ届く', async () => {
    const bp = line()
    const unconnected = await runCreateStress(bp, { pack: null, ports: [] })
    expect(unconnected.rotations?.find((r) => r.pos.join() === '4,0,2')?.rpm ?? 0).toBe(0)

    connect(bp, [1, 0, 1], [4, 0, 1])
    const result = await runCreateStress(bp, { pack: null, ports: [input] })
    const rpm = (pos: string) => result.rotations?.find((r) => r.pos.join() === pos)?.rpm
    expect(rpm('1,0,0')).toBe(16)
    for (const pos of ['1,0,1', '2,0,1', '3,0,1', '4,0,1', '4,0,2']) expect(Math.abs(rpm(pos) ?? 0), pos).toBe(16)
    expect(new Set(['1,0,1', '2,0,1', '3,0,1', '4,0,1', '4,0,2'].map(rpm)).size).toBe(1)
    // 回転数 16 で軸 Z のベルトは、物を負の向き（west）へ運ぶ（docs/create-throughput.md「物の通り道」）
    const items = (result.links ?? []).filter((l) => l.kind === 'item').map((l) => `${l.from.join()}→${l.to.join()}`)
    expect(items.sort()).toEqual(['1,0,1→0,0,1', '2,0,1→1,0,1', '3,0,1→2,0,1', '4,0,1→3,0,1'])
    expect(result.itemMoves?.map((m) => `${m.from.join()}→${m.to.join()}`)).toEqual(['2,0,1→1,0,1', '1,0,1→0,0,1'])
    expect(result.issues).toEqual([])
  })
})

describe('ベルトをつなぐときの抜け', () => {
  it('間のマスがリージョンのすき間なら、設計図の外としてつなげない', () => {
    const shaftZ = new BlockState(ResourceLocation.parse('create:shaft'), { axis: 'z' })
    const a = new BlockVolume({ name: 'a', size: [1, 1, 1], palette: [shaftZ], cells: Int32Array.of(0) })
    const b = new BlockVolume({ name: 'b', size: [1, 1, 1], offset: [3, 0, 0], palette: [shaftZ], cells: Int32Array.of(0) })
    const bp = new Blueprint('two', 'litematic', 2975, [a, b], {})
    expect(beltConnectionProblem(bp, [0, 0, 0], [3, 0, 0])).toBe('間の (1, 0, 0) が設計図の外です。')
  })

  it('[PL-BELT-WATER] 泡の柱のマスに置く区間も waterlogged=true', () => {
    const bp = blueprintFixture({ size: [3, 1, 1] })
      .place([0, 0, 0], 'create:shaft', { axis: 'z', waterlogged: 'false' })
      .place([1, 0, 0], 'minecraft:bubble_column', { drag: 'true' })
      .place([2, 0, 0], 'create:shaft', { axis: 'z', waterlogged: 'false' })
      .toBlueprint()
    expect(plan(bp, [0, 0, 0], [2, 0, 0]).segments.map((s) => s.after.state?.properties['waterlogged'])).toEqual(['false', 'true', 'false'])
  })
})
