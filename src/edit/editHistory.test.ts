import { describe, expect, it } from 'vitest'
import { BlockState } from '../domain/blockState'
import { BlockVolume } from '../domain/blockVolume'
import { Blueprint } from '../domain/blueprint'
import { nbt, type RawNbt } from '../domain/nbt'
import { ResourceLocation } from '../domain/resourceLocation'
import type { Vec3 } from '../domain/vec3'
import { eraseBlock, placeBlock, placeBlocks, rotateBlock, type EditCommand } from './editCommand'
import { EditHistory } from './editHistory'

const stone = new BlockState(ResourceLocation.parse('minecraft:stone'))
const shaftX = new BlockState(ResourceLocation.parse('create:shaft'), { axis: 'x' })
const shaftZ = new BlockState(ResourceLocation.parse('create:shaft'), { axis: 'z' })
const gearbox = new BlockState(ResourceLocation.parse('create:gearbox'), { axis: 'y' })
const furnace = new BlockState(ResourceLocation.parse('minecraft:furnace'), { facing: 'north', lit: 'false' })

/** tests/fixtures（#5）のヘルパーができるまでの代わり。blocks の位置に状態と生データを置く */
function volume(
  name: string,
  size: Vec3,
  offset: Vec3,
  blocks: [Vec3, BlockState, RawNbt?][],
): BlockVolume {
  const palette: BlockState[] = []
  const cells = new Int32Array(size[0] * size[1] * size[2]).fill(-1)
  const blockEntities = new Map<number, RawNbt>()
  for (const [[x, y, z], state, be] of blocks) {
    let p = palette.indexOf(state)
    if (p < 0) p = palette.push(state) - 1
    const i = (y * size[2] + z) * size[0] + x
    cells[i] = p
    if (be) blockEntities.set(i, be)
  }
  return new BlockVolume({ name, size, offset, palette, cells, blockEntities })
}

function shaftNbt(speed: number): RawNbt {
  return nbt.compound({
    id: nbt.string('create:shaft'),
    Speed: nbt.float(speed),
    Network: nbt.long(123456789012345n),
    Extra: nbt.list('int', [nbt.int(1), nbt.int(2)]),
  })
}

/** 2つのリージョンを持つ設計図。2つめは x 方向に 3 ずらして置く */
function makeBlueprint(): Blueprint {
  const a = volume('a', [3, 2, 3], [0, 0, 0], [
    [[0, 0, 0], stone],
    [[1, 0, 0], shaftX, shaftNbt(16)],
    [[2, 1, 2], furnace, nbt.compound({ id: nbt.string('minecraft:furnace'), BurnTime: nbt.short(40) })],
  ])
  const b = volume('b', [2, 2, 2], [3, 0, 0], [
    [[0, 0, 0], gearbox, nbt.compound({ id: nbt.string('create:gearbox') })],
    [[1, 1, 1], stone],
  ])
  return new Blueprint('test.nbt', 'nbt', 2975, [a, b])
}

interface CellSnapshot {
  region: string
  pos: Vec3
  key: string
  blockEntity: RawNbt | null
}

/** 設計図の中身を比べられる形にする。空きでないマスと、その生データ（参照）を並べる */
function snapshot(bp: Blueprint): { cells: CellSnapshot[]; used: string[] } {
  const cells: CellSnapshot[] = []
  const used = new Set<string>()
  for (const r of bp.regions) {
    r.forEachBlock((x, y, z, state, blockEntity) => {
      cells.push({ region: r.name, pos: [x, y, z], key: state.key, blockEntity })
      used.add(state.key)
    })
  }
  return { cells, used: [...used].sort() }
}

/** 生データは同じオブジェクトがそのまま戻ること、中身も同じことを確かめる */
function expectSameState(bp: Blueprint, expected: ReturnType<typeof snapshot>): void {
  const actual = snapshot(bp)
  expect(actual.used).toEqual(expected.used)
  expect(actual.cells.length).toBe(expected.cells.length)
  actual.cells.forEach((cell, i) => {
    const want = expected.cells[i]
    expect(cell.region).toBe(want.region)
    expect(cell.pos).toEqual(want.pos)
    expect(cell.key).toBe(want.key)
    expect(cell.blockEntity).toBe(want.blockEntity)
    expect(cell.blockEntity).toEqual(want.blockEntity)
  })
}

// 操作を作る関数の一覧。どれも元に戻す・やり直すで完全に戻ることを確かめる
const operations: [string, (bp: Blueprint) => EditCommand | null][] = [
  ['空きに置く', (bp) => placeBlock(bp, [1, 1, 1], gearbox, false)],
  ['生データのあるブロックを置き換える', (bp) => placeBlock(bp, [1, 0, 0], stone, true)],
  ['2つめのリージョンに置く', (bp) => placeBlock(bp, [4, 0, 1], furnace, false)],
  ['生データのあるブロックを消す', (bp) => eraseBlock(bp, [1, 0, 0])],
  ['2つめのリージョンのブロックを消す', (bp) => eraseBlock(bp, [3, 0, 0])],
  ['生データのあるブロックを回す（水平）', (bp) => rotateBlock(bp, [1, 0, 0], false)],
  ['生データのあるブロックを回す（縦）', (bp) => rotateBlock(bp, [2, 1, 2], true)],
  ['2つめのリージョンのブロックを回す', (bp) => rotateBlock(bp, [3, 0, 0], true)],
  // 2つのリージョンをまたぐ一直線（埋まったマスは飛ばす。#161）
  ['一直線に置く', (bp) => placeBlocks(bp, [[1, 1, 0], [2, 1, 0], [3, 1, 0], [4, 1, 0], [3, 0, 0]], shaftX)],
]

describe('placeBlocks（#161）', () => {
  it('空きマスだけに置き、埋まったマス・範囲の外・重なりは飛ばす。1つも置けなければ null', () => {
    const bp = makeBlueprint()
    const cmd = placeBlocks(bp, [[0, 0, 0], [0, 1, 0], [0, 1, 0], [9, 0, 0], [1, 1, 1]], shaftZ)
    expect(cmd?.changes.map((c) => c.pos)).toEqual([[0, 1, 0], [1, 1, 1]])
    expect(cmd?.label).toBe('shaft を一直線に置く（2 個）')
    expect(placeBlocks(bp, [[0, 0, 0], [9, 9, 9]], shaftZ)).toBeNull()
  })
})

describe('EditHistory：元に戻す・やり直す', () => {
  it.each(operations)('%s：元に戻すと完全に元の状態になり、やり直すと操作のあとと同じになる', (_name, make) => {
    const bp = makeBlueprint()
    const original = snapshot(bp)
    const history = new EditHistory(bp)
    const cmd = make(bp)
    expect(cmd).not.toBeNull()
    if (!cmd) return
    // 操作を作っただけでは設計図は変わらない
    expectSameState(bp, original)

    history.apply(cmd)
    const applied = snapshot(bp)
    expect(applied).not.toEqual(original)

    expect(history.undo()).toBe(cmd)
    expectSameState(bp, original)

    expect(history.redo()).toBe(cmd)
    expectSameState(bp, applied)

    expect(history.undo()).toBe(cmd)
    expectSameState(bp, original)
  })

  it('続けた操作をすべて元に戻すと元の状態に、すべてやり直すと最後の状態になる', () => {
    const bp = makeBlueprint()
    const original = snapshot(bp)
    const history = new EditHistory(bp)
    const states: ReturnType<typeof snapshot>[] = [original]
    for (const [, make] of operations) {
      const cmd = make(bp)
      if (!cmd) continue
      history.apply(cmd)
      states.push(snapshot(bp))
    }
    expect(history.count).toBe(states.length - 1)

    for (let i = states.length - 2; i >= 0; i--) {
      history.undo()
      expectSameState(bp, states[i])
    }
    expect(history.canUndo).toBe(false)
    expect(history.undo()).toBeNull()

    for (let i = 1; i < states.length; i++) {
      history.redo()
      expectSameState(bp, states[i])
    }
    expect(history.canRedo).toBe(false)
    expect(history.redo()).toBeNull()
  })

  it('同じマスを2回変える操作も、元に戻すと元の状態になる', () => {
    const bp = makeBlueprint()
    const original = snapshot(bp)
    const before = bp.locate([1, 0, 0])?.region.cellAt(1, 0, 0)
    if (!before) throw new Error('マスがありません')
    const cmd: EditCommand = {
      label: 'テスト',
      changes: [
        { pos: [1, 0, 0], before, after: { state: stone, blockEntity: null } },
        { pos: [1, 0, 0], before: { state: stone, blockEntity: null }, after: { state: null, blockEntity: null } },
      ],
    }
    const history = new EditHistory(bp)
    history.apply(cmd)
    expect(bp.get([1, 0, 0])).toBeNull()
    history.undo()
    expectSameState(bp, original)
  })

  it('新しい操作をするとやり直す側は空になる', () => {
    const bp = makeBlueprint()
    const history = new EditHistory(bp)
    const first = placeBlock(bp, [1, 1, 1], gearbox, false)
    if (!first) throw new Error('操作を作れません')
    history.apply(first)
    history.undo()
    expect(history.canRedo).toBe(true)
    expect(history.nextRedo).toBe(first)

    const second = eraseBlock(bp, [0, 0, 0])
    if (!second) throw new Error('操作を作れません')
    history.apply(second)
    expect(history.canRedo).toBe(false)
    expect(history.nextRedo).toBeNull()
    expect(history.nextUndo?.label).toBe('stone を消す')
    expect(history.count).toBe(1)
  })

  it('apply / undo / redo のたびに onChange で合図する', () => {
    const bp = makeBlueprint()
    const history = new EditHistory(bp)
    let calls = 0
    const disconnect = history.onChange.connect(() => calls++)
    const cmd = eraseBlock(bp, [0, 0, 0])
    if (!cmd) throw new Error('操作を作れません')
    history.apply(cmd)
    history.undo()
    history.redo()
    expect(calls).toBe(3)
    // 戻せる操作がないときは合図しない
    history.undo()
    history.undo()
    expect(calls).toBe(4)
    disconnect()
    history.redo()
    expect(calls).toBe(4)
  })

  it('書き出してからの変更：apply / undo / redo を数え、markSaved で 0 に戻す', () => {
    const bp = makeBlueprint()
    const history = new EditHistory(bp)
    expect(history.unsavedChanges).toBe(0)
    const cmd = eraseBlock(bp, [0, 0, 0])
    if (!cmd) throw new Error('操作を作れません')
    history.apply(cmd)
    history.undo()
    expect(history.unsavedChanges).toBe(2)
    // 戻せる操作がないときは数えない
    history.undo()
    expect(history.unsavedChanges).toBe(2)

    let calls = 0
    history.onChange.connect(() => calls++)
    history.markSaved()
    expect(history.unsavedChanges).toBe(0)
    expect(calls).toBe(1)
    // 変わらないときは合図しない
    history.markSaved()
    expect(calls).toBe(1)

    history.redo()
    expect(history.unsavedChanges).toBe(1)
  })

  it('書き出しの途中の変更は、始めたときの回数で印を付けると残る', () => {
    const bp = makeBlueprint()
    const history = new EditHistory(bp)
    const first = eraseBlock(bp, [0, 0, 0])
    if (!first) throw new Error('操作を作れません')
    history.apply(first)
    const at = history.changeCount
    const second = placeBlock(bp, [1, 1, 1], gearbox, false)
    if (!second) throw new Error('操作を作れません')
    history.apply(second)
    history.markSaved(at)
    expect(history.unsavedChanges).toBe(1)
    // 前の書き出しの印で後の印を戻さない
    history.markSaved()
    history.markSaved(at)
    expect(history.unsavedChanges).toBe(0)
  })
})

describe('操作を作る関数', () => {
  it('placeBlock：新しく置いたブロックの生データは null', () => {
    const bp = makeBlueprint()
    const cmd = placeBlock(bp, [1, 0, 0], shaftZ, true)
    expect(cmd?.label).toBe('shaft を置く')
    new EditHistory(bp).apply(cmd as EditCommand)
    expect(bp.get([1, 0, 0])?.key).toBe(shaftZ.key)
    expect(bp.blockEntityAt([1, 0, 0])).toBeNull()
  })

  it('placeBlock：置けないときは null', () => {
    const bp = makeBlueprint()
    // 範囲の外
    expect(placeBlock(bp, [10, 0, 0], stone, true)).toBeNull()
    expect(placeBlock(bp, [-1, 0, 0], stone, true)).toBeNull()
    // replace が false で空きでない
    expect(placeBlock(bp, [0, 0, 0], shaftX, false)).toBeNull()
    // 同じ状態がすでにあり、生データもない
    expect(placeBlock(bp, [0, 0, 0], stone, true)).toBeNull()
    // 同じ状態でも生データがあれば置き直せる（生データが消える）
    expect(placeBlock(bp, [1, 0, 0], shaftX, true)).not.toBeNull()
  })

  it('eraseBlock：空きと範囲の外は null', () => {
    const bp = makeBlueprint()
    expect(eraseBlock(bp, [1, 1, 1])).toBeNull()
    expect(eraseBlock(bp, [0, 5, 0])).toBeNull()
    expect(eraseBlock(bp, [0, 0, 0])?.label).toBe('stone を消す')
  })

  it('rotateBlock：回転の規則で回し、生データをそのまま引き継ぐ', () => {
    const bp = makeBlueprint()
    const be = bp.blockEntityAt([1, 0, 0])
    const cmd = rotateBlock(bp, [1, 0, 0], false)
    expect(cmd?.label).toBe('shaft を回す')
    new EditHistory(bp).apply(cmd as EditCommand)
    expect(bp.get([1, 0, 0])?.key).toBe(shaftZ.key)
    expect(bp.blockEntityAt([1, 0, 0])).toBe(be)

    const furnaceBe = bp.blockEntityAt([2, 1, 2])
    const history = new EditHistory(bp)
    history.apply(rotateBlock(bp, [2, 1, 2], false) as EditCommand)
    expect(bp.get([2, 1, 2])?.properties).toEqual({ facing: 'east', lit: 'false' })
    expect(bp.blockEntityAt([2, 1, 2])).toBe(furnaceBe)
  })

  it('rotateBlock：取りうる値の一覧に従う', () => {
    const bp = makeBlueprint()
    // facing が水平の向きしか取れないので、縦の回転では変わらない
    const modpack = {
      blockStateDefinition: () => ({
        variants: { 'facing=north': {}, 'facing=east': {}, 'facing=south': {}, 'facing=west': {} },
      }),
    }
    expect(rotateBlock(bp, [2, 1, 2], true, modpack)).toBeNull()
    expect(rotateBlock(bp, [2, 1, 2], false, modpack)).not.toBeNull()
  })

  it('rotateBlock：空き・範囲の外・回せる向きがないときは null', () => {
    const bp = makeBlueprint()
    expect(rotateBlock(bp, [1, 1, 1], false)).toBeNull()
    expect(rotateBlock(bp, [9, 9, 9], false)).toBeNull()
    expect(rotateBlock(bp, [0, 0, 0], false)).toBeNull() // stone
    expect(rotateBlock(bp, [3, 0, 0], false)).toBeNull() // gearbox axis=y は水平の回転で変わらない
  })

  it('操作を作るだけでは設計図を変えない', () => {
    const bp = makeBlueprint()
    const original = snapshot(bp)
    const paletteSizes = bp.regions.map((r) => r.palette.length)
    placeBlock(bp, [1, 1, 1], shaftZ, false)
    eraseBlock(bp, [0, 0, 0])
    rotateBlock(bp, [1, 0, 0], true)
    expectSameState(bp, original)
    expect(bp.regions.map((r) => r.palette.length)).toEqual(paletteSizes)
  })
})
