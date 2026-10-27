import { describe, expect, it } from 'vitest'
import { blueprintContents, blueprintFixture, entityNbt } from '../../tests/fixtures/blueprintFixture'
import type { Blueprint } from '../domain/blueprint'
import { translation, type BlockTransform } from '../domain/blockTransform'
import { boxFromCorners } from '../domain/box'
import { nbt } from '../domain/nbt'
import type { Vec3 } from '../domain/vec3'
import type { EditCommand } from './editCommand'
import { EditHistory } from './editHistory'
import { CLIP_MESSAGES, copyRegion, cutRegion, pasteClip, pasteOverlapCount, type BlueprintClip } from './regionClip'
import { entityBlockPos, MOVE_MESSAGES, relocatePos, type TransformOptions } from './regionTransform'

const motorNbt = () => nbt.compound({ id: nbt.string('create:creative_motor'), Speed: nbt.int(64) })
const none = translation([0, 0, 0])
const turn = (quarterTurns: 1 | 2 | 3): BlockTransform => ({ translate: [0, 0, 0], quarterTurns, mirror: 'none', pivot: [0, 0, 0] })

// 4×2×3。下の段に shaft・motor（生データ付き）、離れた所に stone。motor の上に額縁
function sample() {
  return blueprintFixture({ size: [4, 2, 3] })
    .place([0, 0, 0], 'create:shaft[axis=x]')
    .place([1, 0, 0], 'create:creative_motor[facing=up]', motorNbt())
    .place([3, 0, 2], 'minecraft:stone')
    .entity(entityNbt([1, 1, 0], 'minecraft:item_frame', nbt.compound({ TileX: nbt.int(101), TileY: nbt.int(65), TileZ: nbt.int(7) })))
    .toBlueprint()
}

/** 操作を書き、元に戻す・やり直すで中身がそろうかを確かめる */
function applyAndCheck(bp: Blueprint, cmd: EditCommand): void {
  const original = blueprintContents(bp)
  const history = new EditHistory(bp)
  history.apply(cmd)
  const edited = blueprintContents(bp)
  history.undo()
  expect(blueprintContents(bp)).toEqual(original)
  history.redo()
  expect(blueprintContents(bp)).toEqual(edited)
}

function paste(bp: Blueprint, clip: BlueprintClip, at: Vec3, t: BlockTransform = none, opts: TransformOptions = { overwrite: false }) {
  const result = pasteClip(bp, clip, at, t, opts)
  if (!result.ok) throw new Error(result.reason)
  applyAndCheck(bp, result.command)
  return result
}

describe('copyRegion', () => {
  it('ブロックがあるマスと生データ、範囲の中のエンティティを、最小の角からの相対位置で写す', () => {
    const clip = copyRegion(sample(), boxFromCorners([1, 0, 0], [3, 1, 2]))
    expect(clip.size).toEqual([3, 2, 3])
    expect(clip.cells.map((c) => [c.pos, c.cell.state?.key])).toEqual([
      [[0, 0, 0], 'create:creative_motor[facing=up]'],
      [[2, 0, 2], 'minecraft:stone'],
    ])
    expect(clip.cells[0]!.cell.blockEntity).toEqual(motorNbt())
    expect(clip.entities.map(entityBlockPos)).toEqual([[0, 1, 0]])
    expect(clip.dataVersion).toBe(2975)
  })

  it('範囲の外のエンティティは写さない', () => {
    expect(copyRegion(sample(), boxFromCorners([0, 0, 0], [0, 1, 0])).entities).toEqual([])
  })
})

describe('cutRegion', () => {
  it('範囲の中のブロックとエンティティを消し、元に戻せる', () => {
    const bp = sample()
    const cmd = cutRegion(bp, boxFromCorners([1, 0, 0], [1, 1, 0]))!
    expect(cmd.label).toBe('範囲を切り取る（1 個）')
    applyAndCheck(bp, cmd)
    expect(bp.get([1, 0, 0])).toBeNull()
    expect(bp.regions[0]!.entities).toEqual([])
    expect(bp.get([0, 0, 0])?.key).toBe('create:shaft[axis=x]')
  })

  it('消すものがなければ null', () => {
    expect(cutRegion(sample(), boxFromCorners([2, 0, 0], [2, 1, 1]))).toBeNull()
  })
})

describe('pasteClip', () => {
  it('切り抜きを貼る。空きマスは写さないので、行き先のブロックは残る', () => {
    const bp = sample()
    const clip = copyRegion(bp, boxFromCorners([0, 0, 0], [1, 1, 0]))
    const result = paste(bp, clip, [0, 0, 2])
    expect(result.box).toEqual(boxFromCorners([0, 0, 2], [1, 1, 2]))
    expect(result.command.label).toBe('貼り付け（2 個）')
    expect(bp.get([0, 0, 2])?.key).toBe('create:shaft[axis=x]')
    expect(bp.blockEntityAt([1, 0, 2])).toEqual(motorNbt())
    // 元はそのまま
    expect(bp.get([0, 0, 0])?.key).toBe('create:shaft[axis=x]')
    // 額縁は1つ増え、TileZ が 2 ずれる
    const frames = bp.regions[0]!.entities
    expect(frames.map(entityBlockPos)).toEqual([
      [1, 1, 0],
      [1, 1, 2],
    ])
    const inner = frames[1]!.value.get('nbt')
    expect(inner?.type === 'compound' && inner.value.get('TileZ')).toEqual(nbt.int(9))
  })

  it('行き先にブロックがあれば断る。上書きなら貼る', () => {
    const bp = sample()
    const clip = copyRegion(bp, boxFromCorners([0, 0, 0], [1, 0, 0]))
    expect(pasteOverlapCount(bp, clip, [2, 0, 2], none)).toBe(1)
    expect(pasteClip(bp, clip, [2, 0, 2], none, { overwrite: false })).toEqual({ ok: false, reason: CLIP_MESSAGES.blocked(1) })
    paste(bp, clip, [2, 0, 2], none, { overwrite: true })
    expect(bp.get([3, 0, 2])?.key).toBe('create:creative_motor[facing=up]')
  })

  it('回して貼る。回した切り抜きの最小の角が at に来て、向きも回る', () => {
    const bp = sample()
    const clip = copyRegion(bp, boxFromCorners([0, 0, 0], [1, 0, 0]))
    const result = paste(bp, clip, [2, 0, 0], turn(1))
    // 横に2つ並んだものが、縦（z）に2つ並ぶ。右回りなので x の小さい側が z の小さい側へ
    expect(result.box).toEqual(boxFromCorners([2, 0, 0], [2, 0, 1]))
    expect(bp.get([2, 0, 0])?.key).toBe('create:shaft[axis=z]')
    expect(bp.get([2, 0, 1])?.key).toBe('create:creative_motor[facing=up]')
  })

  it('はみ出せば設計図を広げる。負の向きなら全体をずらし、知らせる', () => {
    const bp = sample()
    const clip = copyRegion(bp, boxFromCorners([0, 0, 0], [1, 0, 0]))
    const result = paste(bp, clip, [-1, 0, 4])
    expect(bp.size).toEqual([5, 2, 5])
    expect(result.box).toEqual(boxFromCorners([0, 0, 4], [1, 0, 4]))
    expect(result.warnings).toEqual(['設計図を負の向きに広げたので、座標が x +1 ずれました'])
    // 元のブロックも 1 ずれる
    expect(bp.get([1, 0, 0])?.key).toBe('create:shaft[axis=x]')
    expect(bp.get([0, 0, 4])?.key).toBe('create:shaft[axis=x]')
    // 選択範囲・仮の入出力は shift だけ動く
    expect(relocatePos(result.command.relocation!, [3, 0, 2], true)).toEqual([4, 0, 2])
    expect(relocatePos(result.command.relocation!, [1, 0, 4], false)).toEqual([0, 0, 4])
  })

  it('別の設計図に貼れる。データの版が違えば知らせる', () => {
    const clip = copyRegion(sample(), boxFromCorners([0, 0, 0], [1, 1, 0]))
    const other = blueprintFixture({ size: [2, 2, 2], dataVersion: 3465 }).toBlueprint()
    const result = paste(other, clip, [0, 0, 0])
    expect(other.get([1, 0, 0])?.key).toBe('create:creative_motor[facing=up]')
    expect(other.regions[0]!.entities.map(entityBlockPos)).toEqual([[1, 1, 0]])
    expect(result.warnings).toEqual([CLIP_MESSAGES.dataVersion(2975, 3465)])
  })

  it('生データの中の座標を書き直す。切り抜きの外を指せば知らせる', () => {
    const bp = sample()
    const clip = copyRegion(bp, boxFromCorners([1, 0, 0], [1, 0, 0]))
    const seen: { from: Vec3; to: Vec3 }[] = []
    const result = pasteClip(bp, clip, [2, 0, 1], turn(2), {
      overwrite: false,
      blockEntity: (_s, data, _t, from, to) => {
        seen.push({ from, to })
        return { nbt: data, unresolved: true }
      },
    })
    expect(result.ok && result.warnings).toEqual([MOVE_MESSAGES.unresolvedBlockEntity(1)])
    expect(seen).toEqual([{ from: [0, 0, 0], to: [2, 0, 1] }])
  })

  it('大きさの上限を超えるなら断る', () => {
    const bp = sample()
    const clip = copyRegion(bp, boxFromCorners([0, 0, 0], [1, 0, 0]))
    expect(pasteClip(bp, clip, [600, 0, 0], none, { overwrite: false })).toEqual({ ok: false, reason: MOVE_MESSAGES.tooLarge })
  })
})
