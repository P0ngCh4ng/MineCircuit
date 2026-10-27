import { describe, expect, it } from 'vitest'
import { blueprintContents, blueprintFixture, entityNbt, state } from '../../tests/fixtures/blueprintFixture'
import { BlockVolume } from '../domain/blockVolume'
import { Blueprint } from '../domain/blueprint'
import { boxFromCorners } from '../domain/box'
import { nbt } from '../domain/nbt'
import type { Vec3 } from '../domain/vec3'
import { mirrorWithin, rotationAbout, translation } from '../domain/blockTransform'
import { blueprintToStructure } from '../io/writers/nbtBlueprintWriter'
import { structureToBlueprint } from '../io/readers/nbtBlueprintReader'
import { EditHistory } from './editHistory'
import {
  entityBlockPos,
  MAX_BLUEPRINT_SIDE,
  MOVE_MESSAGES,
  moveEntity,
  moveRegion,
  relocatePlace,
  relocatePos,
  transformRegion,
  type TransformOptions,
} from './regionTransform'

const motorNbt = () => nbt.compound({ id: nbt.string('create:creative_motor'), Speed: nbt.int(64) })

// 4×2×3。下の段に shaft・motor（生データ付き）、離れた所に stone。額縁が1つ
function sample() {
  return blueprintFixture({ size: [4, 2, 3] })
    .place([0, 0, 0], 'create:shaft[axis=x]')
    .place([1, 0, 0], 'create:creative_motor[facing=up]', motorNbt())
    .place([3, 0, 2], 'minecraft:stone')
    .entity(entityNbt([1, 1, 0], 'minecraft:item_frame', nbt.compound({ TileX: nbt.int(101), TileY: nbt.int(65), TileZ: nbt.int(7) })))
    .toBlueprint()
}

/** 動かして、元に戻す・やり直すで中身がそろうかを確かめる */
function applyAndCheck(bp: Blueprint, box: ReturnType<typeof boxFromCorners>, d: Vec3, overwrite = false) {
  const original = blueprintContents(bp)
  const result = moveRegion(bp, box, d, { overwrite })
  if (!result.ok) throw new Error(result.reason)
  const history = new EditHistory(bp)
  history.apply(result.command)
  const edited = blueprintContents(bp)
  history.undo()
  expect(blueprintContents(bp)).toEqual(original)
  history.redo()
  expect(blueprintContents(bp)).toEqual(edited)
  return result
}

describe('moveRegion', () => {
  it('範囲の中身を生データごと動かし、元の所を空ける', () => {
    const bp = sample()
    const result = applyAndCheck(bp, boxFromCorners([0, 0, 0], [1, 0, 0]), [0, 0, 1])
    expect(result.box).toEqual(boxFromCorners([0, 0, 1], [1, 0, 1]))
    expect(result.command.label).toBe('範囲を動かす（2 個）')
    expect(bp.get([0, 0, 0])).toBeNull()
    expect(bp.get([0, 0, 1])?.key).toBe('create:shaft[axis=x]')
    expect(bp.blockEntityAt([1, 0, 1])).toEqual(motorNbt())
    expect(bp.get([3, 0, 2])?.key).toBe('minecraft:stone')
    expect(bp.size).toEqual([4, 2, 3])
  })

  it('元と行き先が重なっても正しく動き、元に戻る', () => {
    const bp = sample()
    applyAndCheck(bp, boxFromCorners([0, 0, 0], [1, 0, 0]), [1, 0, 0])
    expect(bp.get([0, 0, 0])).toBeNull()
    expect(bp.get([1, 0, 0])?.key).toBe('create:shaft[axis=x]')
    expect(bp.get([2, 0, 0])?.key).toBe('create:creative_motor[facing=up]')
  })

  it('行き先に範囲の外のブロックがあれば断る。上書きなら動かす', () => {
    const bp = sample()
    const box = boxFromCorners([0, 0, 0], [1, 0, 0])
    const refused = moveRegion(bp, box, [3, 0, 2], { overwrite: false })
    expect(refused).toEqual({ ok: false, reason: MOVE_MESSAGES.blocked(1) })
    applyAndCheck(bp, box, [3, 0, 2], true)
    expect(bp.get([3, 0, 2])?.key).toBe('create:shaft[axis=x]')
  })

  it('正の向きにはみ出すと設計図を広げ、元に戻すと元の大きさに戻る', () => {
    const bp = sample()
    const result = applyAndCheck(bp, boxFromCorners([0, 0, 0], [1, 0, 0]), [0, 2, 0])
    expect(bp.size).toEqual([4, 3, 3])
    expect(bp.get([1, 2, 0])?.key).toBe('create:creative_motor[facing=up]')
    expect(result.warnings).toEqual([])
  })

  it('負の向きにはみ出すと全体をずらして 0 から始める', () => {
    const bp = sample()
    const result = applyAndCheck(bp, boxFromCorners([0, 0, 0], [1, 0, 0]), [-2, 0, 0])
    expect(bp.size).toEqual([6, 2, 3])
    expect(bp.regions[0]!.offset).toEqual([0, 0, 0])
    expect(bp.get([0, 0, 0])?.key).toBe('create:shaft[axis=x]')
    expect(bp.get([1, 0, 0])?.key).toBe('create:creative_motor[facing=up]')
    // 範囲の外のブロックも全体と一緒にずれる
    expect(bp.get([5, 0, 2])?.key).toBe('minecraft:stone')
    expect(result.box).toEqual(boxFromCorners([0, 0, 0], [1, 0, 0]))
    expect(result.command.relocation).toEqual({
      source: boxFromCorners([0, 0, 0], [1, 0, 0]),
      target: boxFromCorners([0, 0, 0], [1, 0, 0]),
      transform: translation([-2, 0, 0]),
      shift: [2, 0, 0],
    })
    expect(result.warnings).toEqual(['設計図を負の向きに広げたので、座標が x +2 ずれました'])
  })

  it('範囲の中のエンティティは一緒に動き、外のものは全体のずれだけ動く', () => {
    const bp = blueprintFixture({ size: [3, 1, 1] })
      .place([0, 0, 0], 'minecraft:stone')
      .entity(entityNbt([0, 0, 0], 'minecraft:armor_stand'))
      .entity(entityNbt([2, 0, 0], 'minecraft:item_frame', nbt.compound({ TileX: nbt.int(12) })))
      .toBlueprint()
    applyAndCheck(bp, boxFromCorners([0, 0, 0], [0, 0, 0]), [-1, 0, 0])
    const [stand, frame] = bp.regions[0]!.entities
    // 全体が +1 ずれ、範囲の中は −1 動くので、立てる台は 0 のまま
    expect(entityBlockPos(stand!)).toEqual([0, 0, 0])
    expect(entityBlockPos(frame!)).toEqual([3, 0, 0])
    const tile = frame!.value.get('nbt')
    expect(tile?.type === 'compound' && tile.value.get('TileX')).toEqual(nbt.int(13))
  })

  it('額縁の pos・blockPos・TileX を直す', () => {
    const moved = moveEntity(entityNbt([1, 1, 0], 'minecraft:item_frame', nbt.compound({ TileX: nbt.int(5) })), [2, 0, -1])
    expect(moved.value.get('pos')).toEqual(nbt.list('double', [nbt.double(3.5), nbt.double(1.5), nbt.double(-0.5)]))
    expect(entityBlockPos(moved)).toEqual([3, 1, -1])
  })

  it('広げて動かしたあとも、書き出して読み直すと配置・生データ・エンティティが一致する', () => {
    const bp = sample()
    applyAndCheck(bp, boxFromCorners([0, 0, 0], [1, 1, 0]), [-1, 1, 0])
    const reread = structureToBlueprint(bp.name, blueprintToStructure(bp))
    expect(blueprintContents(reread)).toEqual(blueprintContents(bp))
    expect(reread.size).toEqual([5, 3, 3])
  })

  it('各辺 512 を超えるなら断る', () => {
    const bp = sample()
    const result = moveRegion(bp, boxFromCorners([0, 0, 0], [0, 0, 0]), [MAX_BLUEPRINT_SIDE, 0, 0], { overwrite: false })
    expect(result).toEqual({ ok: false, reason: MOVE_MESSAGES.tooLarge })
  })

  it('範囲が設計図の外なら断る', () => {
    const bp = sample()
    expect(moveRegion(bp, boxFromCorners([5, 0, 0], [6, 0, 0]), [1, 0, 0], { overwrite: false })).toEqual({
      ok: false,
      reason: MOVE_MESSAGES.outside,
    })
  })

  describe('リージョンが2つ', () => {
    function twoRegions() {
      const a = new BlockVolume({ name: 'a', size: [2, 1, 1] })
      const b = new BlockVolume({ name: 'b', offset: [4, 0, 0], size: [2, 1, 1] })
      const bp = new Blueprint('two', 'litematic', 3465, [a, b])
      const history = new EditHistory(bp)
      // 置く操作でブロックを入れる
      history.apply({
        label: 'place',
        changes: [{ pos: [0, 0, 0], before: { state: null, blockEntity: null }, after: { state: state('minecraft:stone'), blockEntity: null } }],
      })
      return bp
    }

    it('範囲のあるリージョンを広げ、ほかのリージョンは全体のずれだけ動く', () => {
      const bp = twoRegions()
      applyAndCheck(bp, boxFromCorners([0, 0, 0], [0, 0, 0]), [0, 0, -1])
      expect(bp.regions[0]!.offset).toEqual([0, 0, 0])
      expect(bp.regions[0]!.size).toEqual([2, 1, 2])
      expect(bp.regions[1]!.offset).toEqual([4, 0, 1])
      expect(bp.get([0, 0, 0])?.key).toBe('minecraft:stone')
    })

    it('広げた先がほかのリージョンに重なるなら断る', () => {
      const bp = twoRegions()
      expect(moveRegion(bp, boxFromCorners([0, 0, 0], [0, 0, 0]), [4, 0, 0], { overwrite: true })).toEqual({
        ok: false,
        reason: MOVE_MESSAGES.overlapsRegion,
      })
    })

    it('2つのリージョンにまたがる範囲は断る', () => {
      const bp = twoRegions()
      expect(moveRegion(bp, boxFromCorners([0, 0, 0], [5, 0, 0]), [0, 1, 0], { overwrite: false })).toEqual({
        ok: false,
        reason: MOVE_MESSAGES.acrossRegions,
      })
    })
  })
})

describe('transformRegion（回す・反転する）', () => {
  function check(bp: Blueprint, box: ReturnType<typeof boxFromCorners>, t: ReturnType<typeof rotationAbout>, opts: Partial<TransformOptions> = {}) {
    const original = blueprintContents(bp)
    const result = transformRegion(bp, box, t, { overwrite: false, ...opts })
    if (!result.ok) throw new Error(result.reason)
    const history = new EditHistory(bp)
    history.apply(result.command)
    const edited = blueprintContents(bp)
    history.undo()
    expect(blueprintContents(bp)).toEqual(original)
    history.redo()
    expect(blueprintContents(bp)).toEqual(edited)
    return result
  }

  // 3×1×3。中心は [1,0,1]。東に x 軸のシャフト、北に north 向きのファンネル
  function cross() {
    return blueprintFixture({ size: [3, 1, 3] })
      .place([1, 0, 1], 'create:cogwheel[axis=y]')
      .place([2, 0, 1], 'create:shaft[axis=x]', motorNbt())
      .place([1, 0, 0], 'create:andesite_funnel[facing=north]')
      .entity(entityNbt([2, 0, 1], 'minecraft:item_frame', nbt.compound({ TileX: nbt.int(12), Facing: nbt.byte(5), Rotation: nbt.list('float', [nbt.float(270), nbt.float(0)]) })))
      .toBlueprint()
  }

  it('右回りに回すと、位置と向きと生データが一緒に回る', () => {
    const bp = cross()
    const box = boxFromCorners([0, 0, 0], [2, 0, 2])
    const result = check(bp, box, rotationAbout(box, 1))
    expect(result.command.label).toBe('範囲を回す（3 個）')
    expect(bp.get([1, 0, 2])?.key).toBe('create:shaft[axis=z]')
    expect(bp.blockEntityAt([1, 0, 2])).toEqual(motorNbt())
    expect(bp.get([2, 0, 1])?.key).toBe('create:andesite_funnel[facing=east]')
    expect(bp.get([1, 0, 1])?.key).toBe('create:cogwheel[axis=y]')
    // 額縁は東の面（Facing 5）から南（3）へ、yaw は 270（east）から 0（south）へ
    const frame = bp.regions[0]!.entities[0]!
    expect(entityBlockPos(frame)).toEqual([1, 0, 2])
    const inner = frame.value.get('nbt')
    if (inner?.type !== 'compound') throw new Error('nbt がない')
    expect(inner.value.get('Facing')).toEqual(nbt.byte(3))
    expect(inner.value.get('TileZ')).toBeUndefined()
    expect(inner.value.get('TileX')).toEqual(nbt.int(11))
    expect(inner.value.get('Rotation')).toEqual(nbt.list('float', [nbt.float(0), nbt.float(0)]))
  })

  it('4回回すと元の設計図に戻る', () => {
    const bp = cross()
    const original = blueprintContents(bp)
    const box = boxFromCorners([0, 0, 0], [2, 0, 2])
    const history = new EditHistory(bp)
    for (let i = 0; i < 4; i++) {
      const result = transformRegion(bp, box, rotationAbout(box, 1), { overwrite: false })
      if (!result.ok) throw new Error(result.reason)
      history.apply(result.command)
    }
    expect(blueprintContents(bp)).toEqual(original)
  })

  it('細長い範囲を回すとはみ出し、設計図を広げる（負の向きなら全体をずらす）', () => {
    const bp = sample() // 4×2×3
    const box = boxFromCorners([0, 0, 0], [3, 0, 0])
    const result = check(bp, box, rotationAbout(box, 1))
    // 中心 [1,0,0] のまわりで、x 0〜3 が z −1〜2 になる。z が +1 ずれる
    expect(result.box).toEqual(boxFromCorners([1, 0, 0], [1, 0, 3]))
    expect(bp.size).toEqual([4, 2, 4])
    expect(result.warnings).toEqual(['設計図を負の向きに広げたので、座標が z +1 ずれました'])
    expect(bp.get([1, 0, 0])?.key).toBe('create:shaft[axis=z]')
    expect(bp.get([1, 0, 1])?.key).toBe('create:creative_motor[facing=up]')
  })

  it('反転は範囲の中で写し、向きと左右を変える', () => {
    const bp = blueprintFixture({ size: [2, 1, 1] })
      .place([0, 0, 0], 'minecraft:oak_door[facing=east,half=lower,hinge=left]')
      .place([1, 0, 0], 'minecraft:furnace[facing=west]')
      .toBlueprint()
    const box = boxFromCorners([0, 0, 0], [1, 0, 0])
    const result = check(bp, box, mirrorWithin(box, 'x'))
    expect(result.box).toEqual(box)
    expect(result.command.label).toBe('範囲を反転する（2 個）')
    expect(bp.get([0, 0, 0])?.key).toBe('minecraft:furnace[facing=east]')
    expect(bp.get([1, 0, 0])?.key).toBe('minecraft:oak_door[facing=west,half=lower,hinge=right]')
  })

  it('生データを直す関数を通し、直せないものは警告に出す', () => {
    const bp = cross()
    const box = boxFromCorners([0, 0, 0], [2, 0, 2])
    const result = check(bp, box, rotationAbout(box, 1), {
      blockEntity: (state, raw, _t, from, to) =>
        state.id.path === 'shaft' ? { nbt: nbt.compound({ ...Object.fromEntries(raw.value), From: nbt.intArray(from), To: nbt.intArray(to) }), unresolved: true } : null,
    })
    expect(bp.blockEntityAt([1, 0, 2])?.value.get('From')).toEqual(nbt.intArray([2, 0, 1]))
    expect(bp.blockEntityAt([1, 0, 2])?.value.get('To')).toEqual(nbt.intArray([1, 0, 2]))
    expect(result.warnings).toEqual([MOVE_MESSAGES.unresolvedBlockEntity(1)])
  })
})

describe('relocatePos', () => {
  const r = { source: boxFromCorners([0, 0, 0], [1, 0, 0]), target: boxFromCorners([0, 0, 0], [1, 0, 0]), transform: translation([-2, 0, 0]), shift: [2, 0, 0] as Vec3 }
  it('範囲の中は translate と shift、外は shift だけ動き、逆の向きで戻る', () => {
    expect(relocatePos(r, [1, 0, 0], true)).toEqual([1, 0, 0])
    expect(relocatePos(r, [3, 0, 2], true)).toEqual([5, 0, 2])
    expect(relocatePos(r, [1, 0, 0], false)).toEqual([1, 0, 0])
    expect(relocatePos(r, [5, 0, 2], false)).toEqual([3, 0, 2])
  })
})

describe('relocatePlace', () => {
  it('範囲の中の仮の入出力は、位置と面を回し、元に戻すと戻る', () => {
    const box = boxFromCorners([0, 0, 0], [2, 0, 2])
    const r = { source: box, target: box, transform: rotationAbout(box, 1), shift: [0, 0, 0] as Vec3 }
    const moved = relocatePlace(r, { pos: [2, 0, 1], face: 'east' }, true)
    expect(moved).toEqual({ pos: [1, 0, 2], face: 'south' })
    expect(relocatePlace(r, moved, false)).toEqual({ pos: [2, 0, 1], face: 'east' })
    expect(relocatePlace(r, { pos: [5, 0, 0], face: 'east' }, true)).toEqual({ pos: [5, 0, 0], face: 'east' })
  })
})
