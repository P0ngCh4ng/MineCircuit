import { describe, expect, it } from 'vitest'
import { blueprintContents, blueprintFixture, entityNbt, state } from '../../tests/fixtures/blueprintFixture'
import { BlockVolume } from '../domain/blockVolume'
import { Blueprint } from '../domain/blueprint'
import { nbt } from '../domain/nbt'
import { blueprintToStructure } from '../io/writers/nbtBlueprintWriter'
import { structureToBlueprint } from '../io/readers/nbtBlueprintReader'
import { vacatedPositions } from './attachmentLedger'
import { placeGrowing, regionToGrow, resizeRegion, RESIZE_MESSAGES, trimRegions, type ResizePlan } from './blueprintResize'
import { EditHistory } from './editHistory'
import { entityBlockPos, MAX_BLUEPRINT_SIDE } from './regionTransform'

const motorNbt = () => nbt.compound({ id: nbt.string('create:creative_motor'), Speed: nbt.int(64) })

// 3×2×3。(0,0,0) に shaft、(2,1,2) に生データ付きの motor。(1,0,1) に防具立て
function sample() {
  return blueprintFixture({ size: [3, 2, 3] })
    .place([0, 0, 0], 'create:shaft[axis=x]')
    .place([2, 1, 2], 'create:creative_motor[facing=up]', motorNbt())
    .entity(entityNbt([1, 0, 1], 'minecraft:armor_stand'))
    .toBlueprint()
}

function planOf(result: ResizePlan | string | null): ResizePlan {
  if (result === null || typeof result === 'string') throw new Error(`操作を作れません: ${result}`)
  return result
}

/** 操作を書き、元に戻すと完全に元どおり、やり直すと同じになることを確かめる */
function applyAndCheck(bp: Blueprint, plan: ResizePlan): void {
  const history = new EditHistory(bp)
  const before = blueprintContents(bp)
  history.apply(plan.command)
  const after = blueprintContents(bp)
  history.undo()
  expect(blueprintContents(bp)).toEqual(before)
  history.redo()
  expect(blueprintContents(bp)).toEqual(after)
}

describe('resizeRegion（6方向に広げる・縮める）', () => {
  it('正の向きに広げると、座標はそのままで大きさだけ変わる', () => {
    const bp = sample()
    const plan = planOf(resizeRegion(bp, 0, { min: [0, 0, 0], max: [2, 1, 0] }))
    expect(plan.sizes.get(0)).toEqual([5, 3, 3])
    expect(plan.shift).toEqual([0, 0, 0])
    expect(plan.command.relocation).toBeUndefined()
    applyAndCheck(bp, plan)
    expect(bp.size).toEqual([5, 3, 3])
    expect(bp.get([2, 1, 2])?.key).toBe('create:creative_motor[facing=up]')
  })

  it('負の向きに広げると、中身とエンティティがずれ、選択範囲と仮の入出力をずらす合図を持つ', () => {
    const bp = sample()
    const plan = planOf(resizeRegion(bp, 0, { min: [2, 0, 1], max: [0, 0, 0] }))
    expect(plan.shift).toEqual([2, 0, 1])
    expect(plan.warnings).toEqual(['設計図を負の向きに広げたので、座標が x +2・z +1 ずれました'])
    expect(plan.command.relocation).toMatchObject({ source: null, shift: [2, 0, 1], keepSelection: true })
    applyAndCheck(bp, plan)
    expect(bp.size).toEqual([5, 2, 4])
    expect(bp.get([2, 0, 1])?.key).toBe('create:shaft[axis=x]')
    expect(bp.blockEntityAt([4, 1, 3])).not.toBeNull()
    expect(entityBlockPos(bp.regions[0]!.entities[0]!)).toEqual([3, 0, 2])
  })

  it('縮めると外に出るブロックとエンティティを消し、元に戻すと戻る。生データも戻る', () => {
    const bp = sample()
    // x− を 1 縮める → shaft（0,0,0）が消える。x+ と y+ を 1 縮める → motor（2,1,2）が消える。x=1 だけが残る
    const plan = planOf(resizeRegion(bp, 0, { min: [-1, 0, 0], max: [-1, -1, 0] }))
    expect(plan.sizes.get(0)).toEqual([1, 1, 3])
    expect(plan.removedBlocks).toBe(2)
    expect(plan.removedEntities).toBe(0)
    expect(plan.shift).toEqual([-1, 0, 0])
    expect(plan.command.label).toBe('大きさを変える（2 個消す）')
    applyAndCheck(bp, plan)
    expect(bp.size).toEqual([1, 1, 3])
    // 防具立て（1,0,1）は残り、x が 1 ずれる
    expect(entityBlockPos(bp.regions[0]!.entities[0]!)).toEqual([0, 0, 1])
  })

  it('縮めた所のエンティティは消える', () => {
    const bp = sample()
    const plan = planOf(resizeRegion(bp, 0, { min: [0, 0, -2], max: [0, 0, 0] }))
    expect(plan.removedEntities).toBe(1)
    expect(plan.removedBlocks).toBe(1)
    applyAndCheck(bp, plan)
    expect(bp.regions[0]!.entities).toEqual([])
  })

  it('消えたブロックに付けた仮の入出力も消せるよう、消えたマスをずれたあとの座標で数える', () => {
    const bp = sample()
    const plan = planOf(resizeRegion(bp, 0, { min: [-1, 0, 0], max: [0, 0, 0] }))
    expect(vacatedPositions(plan.command)).toEqual([[-1, 0, 0]])
  })

  it('各辺が 1 未満・上限を超える・変わらないときは作らない', () => {
    const bp = sample()
    expect(resizeRegion(bp, 0, { min: [0, 0, 0], max: [-3, 0, 0] })).toBe(RESIZE_MESSAGES.tooSmall)
    expect(resizeRegion(bp, 0, { min: [0, 0, 0], max: [MAX_BLUEPRINT_SIDE, 0, 0] })).toBe(RESIZE_MESSAGES.tooLarge)
    expect(resizeRegion(bp, 0, { min: [0, 0, 0], max: [0, 0, 0] })).toBeNull()
    expect(resizeRegion(bp, 3, { min: [0, 0, 0], max: [1, 0, 0] })).toBe(RESIZE_MESSAGES.noRegion)
  })

  it('書き出して読み直しても、広げた大きさと中身が残る', () => {
    const bp = sample()
    new EditHistory(bp).apply(planOf(resizeRegion(bp, 0, { min: [1, 0, 0], max: [0, 2, 0] })).command)
    const again = structureToBlueprint(bp.name, blueprintToStructure(bp))
    expect(again.size).toEqual([4, 4, 3])
    expect(blueprintContents(again).regions).toEqual(blueprintContents(bp).regions)
  })

  describe('リージョンが2つ', () => {
    function twoRegions() {
      const a = new BlockVolume({ name: 'a', size: [2, 1, 1] })
      const b = new BlockVolume({ name: 'b', offset: [4, 0, 0], size: [2, 1, 1] })
      return new Blueprint('two', 'litematic', 3465, [a, b])
    }

    it('選んだリージョンを変え、ほかのリージョンは全体のずれだけ動く', () => {
      const bp = twoRegions()
      const plan = planOf(resizeRegion(bp, 1, { min: [0, 0, 1], max: [0, 0, 0] }))
      applyAndCheck(bp, plan)
      expect(bp.regions[0]!.offset).toEqual([0, 0, 1])
      expect(bp.regions[1]!.offset).toEqual([4, 0, 0])
      expect(bp.regions[1]!.size).toEqual([2, 1, 2])
    })

    it('ほかのリージョンに重なるなら断る', () => {
      expect(resizeRegion(twoRegions(), 0, { min: [0, 0, 0], max: [3, 0, 0] })).toBe(RESIZE_MESSAGES.overlapsRegion)
    })
  })
})

describe('trimRegions（余白を詰める）', () => {
  it('ブロックとエンティティが入る一番小さい箱に縮め、消えるブロックはない', () => {
    const bp = blueprintFixture({ size: [6, 4, 5] })
      .place([2, 1, 1], 'minecraft:stone')
      .place([3, 1, 2], 'minecraft:stone')
      .entity(entityNbt([4, 2, 1], 'minecraft:armor_stand'))
      .toBlueprint()
    const plan = planOf(trimRegions(bp))
    expect(plan.removedBlocks).toBe(0)
    expect(plan.shift).toEqual([-2, -1, -1])
    expect(plan.command.label).toBe('余白を詰める')
    applyAndCheck(bp, plan)
    expect(bp.size).toEqual([3, 2, 2])
    expect(bp.get([0, 0, 0])?.key).toBe('minecraft:stone')
    expect(entityBlockPos(bp.regions[0]!.entities[0]!)).toEqual([2, 1, 0])
  })

  it('詰める所がなければ null。何もなければ 1×1×1', () => {
    expect(trimRegions(blueprintFixture({ size: [1, 1, 1] }).toBlueprint())).toBeNull()
    const full = blueprintFixture({ size: [2, 1, 1] }).fill([0, 0, 0], [1, 0, 0], 'minecraft:stone').toBlueprint()
    expect(trimRegions(full)).toBeNull()
    const empty = blueprintFixture({ size: [3, 3, 3] }).toBlueprint()
    applyAndCheck(empty, planOf(trimRegions(empty)))
    expect(empty.size).toEqual([1, 1, 1])
  })
})

describe('placeGrowing（枠の外へ置く）', () => {
  it('正の向きの外に置くと、そのマスが入るだけ広げて置く。1回で元に戻る', () => {
    const bp = sample()
    const plan = planOf(placeGrowing(bp, 0, [{ pos: [3, 0, 0], state: state('create:shaft[axis=x]') }]))
    expect(plan.command.label).toBe('shaft を置く')
    applyAndCheck(bp, plan)
    expect(bp.size).toEqual([4, 2, 3])
    expect(bp.get([3, 0, 0])?.key).toBe('create:shaft[axis=x]')
  })

  it('負の向きの外に置くと、全体をずらしてから置く', () => {
    const bp = sample()
    const plan = planOf(placeGrowing(bp, 0, [{ pos: [0, 0, -1], state: state('minecraft:stone') }]))
    expect(plan.shift).toEqual([0, 0, 1])
    expect(plan.command.changes.map((c) => c.pos)).toEqual([[0, 0, 0]])
    applyAndCheck(bp, plan)
    expect(bp.get([0, 0, 0])?.key).toBe('minecraft:stone')
    expect(bp.get([0, 0, 1])?.key).toBe('create:shaft[axis=x]')
  })

  it('一直線に置くときは、枠の中と外のマスをまとめて置く', () => {
    const bp = sample()
    const cells = [1, 2, 3, 4].map((x) => ({ pos: [x, 0, 0] as const, state: state('create:shaft[axis=x]') }))
    const plan = planOf(placeGrowing(bp, 0, cells))
    expect(plan.command.label).toBe('shaft を置く（4 個）')
    applyAndCheck(bp, plan)
    expect(bp.size).toEqual([5, 2, 3])
    expect([1, 2, 3, 4].map((x) => bp.get([x, 0, 0])?.key)).toEqual(Array(4).fill('create:shaft[axis=x]'))
  })

  it('上限を超えるなら断る。枠の中だけなら null（ふつうに置く）', () => {
    const bp = blueprintFixture({ size: [MAX_BLUEPRINT_SIDE, 1, 1] }).toBlueprint()
    expect(placeGrowing(bp, 0, [{ pos: [MAX_BLUEPRINT_SIDE, 0, 0], state: state('minecraft:stone') }])).toBe(RESIZE_MESSAGES.placeTooLarge)
    expect(placeGrowing(bp, 0, [{ pos: [0, 0, 0], state: state('minecraft:stone') }])).toBeNull()
  })

  it('広げるリージョンは、1マス以内に枠があるもの', () => {
    const bp = sample()
    expect(regionToGrow(bp, [3, 0, 0])).toBe(0)
    expect(regionToGrow(bp, [-1, -1, -1])).toBe(0)
    expect(regionToGrow(bp, [4, 0, 0])).toBe(-1)
  })
})
