import { describe, expect, it } from 'vitest'
import { fakeAppearanceSet } from '../../../tests/fixtures/fakeAppearance'
import { BlockState } from '../../domain/blockState'
import { nbt } from '../../domain/nbt'
import { ResourceLocation } from '../../domain/resourceLocation'
import { rotateVector } from '../../domain/rotation3'
import { appearanceAlias, appearanceKey, parseBlockStateString, withAliases } from './blockEntityAppearance'

const machine = (facing: string) => new BlockState(ResourceLocation.parse('custommachinery:custom_machine_block'), { facing })
const be = (id: string) => nbt.compound({ machineID: nbt.string(id), componentManager: nbt.compound() })
const lookup = { machineAppearance: (id: string) => ({ 'createastral:distillery': 'test:shaft[axis=y]', 'x:broken': '[' })[id] ?? null }

describe('appearanceKey', () => {
  it('ふつうのブロックは state.key、機械は machineID を足す', () => {
    const stone = new BlockState(ResourceLocation.parse('minecraft:stone'))
    expect(appearanceKey(stone, be('a:b'))).toBe('minecraft:stone')
    expect(appearanceKey(machine('north'), be('createastral:distillery'))).toBe(
      'custommachinery:custom_machine_block[facing=north]|machine=createastral:distillery',
    )
    // 生データがなければ、ふつうの鍵
    expect(appearanceKey(machine('north'), null)).toBe('custommachinery:custom_machine_block[facing=north]')
  })
})

describe('parseBlockStateString', () => {
  it('<id> と <id>[a=b,c=d] を読む', () => {
    expect(parseBlockStateString('astralgenerators:assembler[active=true]')?.key).toBe('astralgenerators:assembler[active=true]')
    expect(parseBlockStateString('techreborn:computer_cube')?.key).toBe('techreborn:computer_cube')
    expect(parseBlockStateString('a:b[broken]')).toBeNull()
    expect(parseBlockStateString('[')).toBeNull()
  })
})

describe('appearanceAlias と withAliases', () => {
  it('機械の定義の見た目のブロックを借り、facing の向きに回す', () => {
    const alias = appearanceAlias(machine('east'), be('createastral:distillery'), lookup)!
    expect(alias.borrow.key).toBe('test:shaft[axis=y]')
    // 東向きは、北を東へ回す
    expect(rotateVector(alias.matrix, [0, 0, -1])).toEqual([1, 0, 0])
    expect(appearanceAlias(machine('north'), be('createastral:unknown'), lookup)).toBeNull()
    expect(appearanceAlias(machine('north'), be('x:broken'), lookup)).toBeNull()
    expect(appearanceAlias(machine('north'), be('createastral:distillery'), null)).toBeNull()
  })

  it('借りた見た目を、部品の回転のあとに matrix を重ねて足す。借りる先が分からなければ null', () => {
    const set = fakeAppearanceSet()
    const alias = appearanceAlias(machine('east'), be('createastral:distillery'), lookup)!
    const out = withAliases(set, [alias, { ...alias, key: 'k2', borrow: new BlockState(ResourceLocation.parse('test:unknown')) }])
    const look = out.appearances[alias.key]!
    expect(look.parts[0]!.model).toBe(set.appearances['test:shaft[axis=y]']!.parts[0]!.model)
    expect(look.parts[0]!.matrix).toEqual(alias.matrix)
    expect(out.appearances['k2']).toBeNull()
    // もとの見た目は変えない
    expect(set.appearances[alias.key]).toBeUndefined()
    expect(withAliases(set, [])).toBe(set)
  })
})
