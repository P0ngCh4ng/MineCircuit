import { describe, expect, it } from 'vitest'
import { blueprintContents, blueprintFixture, cloneNbt } from '../../tests/fixtures/blueprintFixture'
import { nbt, type RawNbt } from '../domain/nbt'
import type { Blueprint } from '../domain/blueprint'
import type { Vec3 } from '../domain/vec3'
import { writeNbt } from '../io/nbt'
import { nbtEquals } from '../io/nbt/nbtEquals'
import { setBlockEntityTag } from './editCommand'
import { EditHistory } from './editHistory'

// 読み込んだ設計図にある、項目の多い生データ（並び・型・入れ子・配列を含む）
function motorNbt(): RawNbt {
  return nbt.compound([
    ['id', nbt.string('create:motor')],
    ['Speed', nbt.float(Math.fround(16.5))],
    ['Network', nbt.compound({ Id: nbt.long(-42n), Stress: nbt.float(Math.fround(0.25)), Size: nbt.int(3) })],
    ['ScrollValue', nbt.int(16)],
    ['Source', nbt.intArray([1, 2, 3])],
    ['Unknown', nbt.list('byte', [nbt.byte(1), nbt.byte(-1)])],
  ])
}

function setup(): { bp: Blueprint; original: RawNbt; snapshot: RawNbt } {
  const original = motorNbt()
  const bp = blueprintFixture({ size: [3, 1, 1] })
    .place([0, 0, 0], 'create:creative_motor', { facing: 'east' }, original)
    .place([1, 0, 0], 'create:shaft', { axis: 'x' })
    .toBlueprint()
  return { bp, original, snapshot: cloneNbt(original) }
}

const bytes = (raw: RawNbt | null): Uint8Array => writeNbt({ name: '', root: raw ?? nbt.compound() })

const MOTOR_POS: Vec3 = [0, 0, 0]

describe('setBlockEntityTag（生データの項目を変える操作）', () => {
  it('項目だけを差し替え、ほかの項目と並びは残す。元の生データは書き換えない', () => {
    const { bp, original, snapshot } = setup()
    const history = new EditHistory(bp)
    const cmd = setBlockEntityTag(bp, MOTOR_POS, 'ScrollValue', nbt.int(64))
    expect(cmd).not.toBeNull()
    history.apply(cmd!)

    const after = bp.blockEntityAt(MOTOR_POS)!
    expect(after).not.toBe(original)
    expect([...after.value.keys()]).toEqual(['id', 'Speed', 'Network', 'ScrollValue', 'Source', 'Unknown'])
    expect(after.value.get('ScrollValue')).toEqual(nbt.int(64))
    expect(nbtEquals(after.value.get('Network')!, snapshot.value.get('Network')!)).toBe(true)
    // 元の生データ（元に戻すときに書き戻すもの）はそのまま
    expect(bytes(original)).toEqual(bytes(snapshot))
  })

  it('元に戻すと、生データがバイト単位で元に戻る。やり直すと変更後に戻る', () => {
    const { bp, snapshot } = setup()
    const beforeAll = blueprintContents(bp)
    const history = new EditHistory(bp)
    history.apply(setBlockEntityTag(bp, MOTOR_POS, 'ScrollValue', nbt.int(64))!)
    const changed = bytes(bp.blockEntityAt(MOTOR_POS))

    history.undo()
    const restored = bp.blockEntityAt(MOTOR_POS)!
    expect(nbtEquals(restored, snapshot)).toBe(true)
    expect(bytes(restored)).toEqual(bytes(snapshot))
    expect(blueprintContents(bp)).toEqual(beforeAll)

    history.redo()
    expect(bytes(bp.blockEntityAt(MOTOR_POS))).toEqual(changed)
    expect(nbtEquals(bp.blockEntityAt(MOTOR_POS)!.value.get('ScrollValue')!, nbt.int(64))).toBe(true)

    history.undo()
    expect(bytes(bp.blockEntityAt(MOTOR_POS))).toEqual(bytes(snapshot))
  })

  it('生データがないブロックは initial から作り、元に戻すと生データなしに戻る', () => {
    const bp = blueprintFixture({ size: [1, 1, 1] }).place([0, 0, 0], 'create:creative_motor', { facing: 'east' }).toBlueprint()
    const history = new EditHistory(bp)
    const initial = nbt.compound({ id: nbt.string('create:motor') })
    history.apply(setBlockEntityTag(bp, MOTOR_POS, 'ScrollValue', nbt.int(64), initial)!)
    const created = bp.blockEntityAt(MOTOR_POS)!
    expect([...created.value.keys()]).toEqual(['id', 'ScrollValue'])
    expect(created.value.get('id')).toEqual(nbt.string('create:motor'))
    // initial は書き換えない
    expect([...initial.value.keys()]).toEqual(['id'])

    history.undo()
    expect(bp.blockEntityAt(MOTOR_POS)).toBeNull()
    expect(bp.get(MOTOR_POS)?.key).toBe('create:creative_motor[facing=east]')
    history.redo()
    expect(bytes(bp.blockEntityAt(MOTOR_POS))).toEqual(bytes(created))
  })

  it('同じ値・空き・範囲の外では操作を作らない', () => {
    const { bp } = setup()
    expect(setBlockEntityTag(bp, MOTOR_POS, 'ScrollValue', nbt.int(16))).toBeNull()
    expect(setBlockEntityTag(bp, [2, 0, 0], 'ScrollValue', nbt.int(64))).toBeNull()
    expect(setBlockEntityTag(bp, [9, 0, 0], 'ScrollValue', nbt.int(64))).toBeNull()
    // 型が違えば別の値（float の 16 → int の 16 は変更になる）
    const typed = blueprintFixture({ size: [1, 1, 1] })
      .place([0, 0, 0], 'create:creative_motor', {}, nbt.compound({ ScrollValue: nbt.float(16) }))
      .toBlueprint()
    expect(setBlockEntityTag(typed, MOTOR_POS, 'ScrollValue', nbt.int(16))).not.toBeNull()
  })

  it('label を渡せば、それを元に戻すボタンの説明に使う', () => {
    const { bp } = setup()
    expect(setBlockEntityTag(bp, MOTOR_POS, 'ScrollValue', nbt.int(1))?.label).toBe('creative_motor の ScrollValue を変える')
    expect(setBlockEntityTag(bp, MOTOR_POS, 'ScrollValue', nbt.int(1), null, '回転数を 1 RPM にする')?.label).toBe(
      '回転数を 1 RPM にする',
    )
  })
})
