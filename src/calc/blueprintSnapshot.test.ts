import { describe, expect, it } from 'vitest'
import { blueprintContents, blueprintFixture, entityNbt } from '../../tests/fixtures/blueprintFixture'
import { nbt } from '../domain/nbt'
import { placeBlock } from '../edit/editCommand'
import { EditHistory } from '../edit/editHistory'
import { state } from '../../tests/fixtures/blueprintFixture'
import { fromSnapshot, toSnapshot } from './blueprintSnapshot'

function sample() {
  return blueprintFixture({ size: [3, 2, 2] })
    .place([0, 0, 0], 'create:shaft', { axis: 'x' })
    .place([1, 0, 0], 'create:creative_motor', { facing: 'east' }, nbt.compound({ ScrollValue: nbt.int(64), Big: nbt.long(1n << 40n) }))
    .place([2, 1, 1], 'minecraft:stone')
    .paletteState('minecraft:unused')
    .entity(entityNbt([0.5, 1, 0.5], 'minecraft:armor_stand'))
    .extra('Railways_DataVersion', nbt.int(3))
    .toBlueprint()
}

describe('設計図の写し（Worker へ送る形）', () => {
  it('structured clone を通して組み立て直すと、配置・状態・生データ・知らない項目が一致する', () => {
    const bp = sample()
    const back = fromSnapshot(structuredClone(toSnapshot(bp)))
    expect(blueprintContents(back)).toEqual(blueprintContents(bp))
    expect(back.name).toBe(bp.name)
    expect(back.regions[0].palette.map((p) => p.key)).toEqual(bp.regions[0].palette.map((p) => p.key))
  })

  it('写したあとに編集しても、写しは変わらない', () => {
    const bp = sample()
    const snapshot = toSnapshot(bp)
    const before = blueprintContents(fromSnapshot(snapshot))
    const cmd = placeBlock(bp, [0, 1, 0], state('minecraft:dirt'), true)
    if (cmd) new EditHistory(bp).apply(cmd)
    expect(blueprintContents(fromSnapshot(snapshot))).toEqual(before)
  })
})
