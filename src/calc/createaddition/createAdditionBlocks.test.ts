import { describe, expect, it } from 'vitest'
import { blueprintFixture, state } from '../../../tests/fixtures/blueprintFixture'
import { nbt } from '../../domain/nbt'
import {
  CREATE_ADDITION_KINETICS,
  caBlockSettings,
  caKineticBlock,
  completeCaState,
  motorActive,
  motorSetSpeed,
} from './createAdditionBlocks'
import { CaValues } from './createAdditionValues'

const V17 = new CaValues('1.7', null, null)
const FABRIC = new CaValues('fabric-1.18', null, null)

describe('Crafts & Additions の回るブロック', () => {
  it('[CA-KIN-MOTOR] [CA-MOTOR-SPEED] モーターは facing の面だけに軸の口があり、facing が負の向きなら回転数が逆になる', () => {
    const east = caKineticBlock(state('createaddition:electric_motor', { facing: 'east', powered: 'false' }), nbt.compound({ ScrollValue: nbt.int(64) }), 'saved', V17)
    expect(east).toMatchObject({ axis: 'x', shaftFaces: ['east'], impact: { value: 0 }, source: { speed: { value: 64, source: 'blueprint' }, capacity: { value: 64 } } })
    // ScrollValue がなければ 32。生データの active がないので、回っているとみなす
    const down = caKineticBlock(state('createaddition:electric_motor', { facing: 'down', powered: 'false' }), null, 'saved', V17)
    expect(down?.source?.speed).toEqual({ value: -32, source: 'builtin' })
    expect(down?.notes).toEqual(['電気モーターの生データに active がないので、回っているとみなした'])
    const zero = caKineticBlock(state('createaddition:electric_motor', { facing: 'west' }), nbt.compound({ ScrollValue: nbt.int(0) }), 'saved', V17)
    expect(Object.is(zero?.source?.speed.value, 0)).toBe(true)
  })

  it('[CA-MOTOR-ACTIVE] 保存された状態は active、動かしたときは powered で決める', () => {
    const motor = (powered: string) => state('createaddition:electric_motor', { facing: 'east', powered })
    const stopped = nbt.compound({ active: nbt.byte(0) })
    expect(motorActive(motor('false'), stopped, 'saved')).toEqual({ active: false, note: null })
    expect(motorActive(motor('false'), nbt.compound({ active: nbt.byte(1) }), 'saved')).toEqual({ active: true, note: null })
    expect(motorActive(motor('true'), null, 'running')).toEqual({ active: false, note: null })
    expect(motorActive(motor('false'), stopped, 'running').active).toBe(true)
    expect(caKineticBlock(motor('false'), stopped, 'saved', V17)?.source?.speed).toEqual({ value: 0, source: 'blueprint' })
    expect(motorSetSpeed(null)).toEqual({ value: 32, source: 'builtin' })
  })

  it('[CA-KIN-ALTERNATOR] [CA-KIN-ROLLING-MILL] 発電機は 1.7.2 なら軸の両側、Fabric 版は facing の面だけ。圧延機は版の応力', () => {
    const alt = state('createaddition:alternator', { facing: 'north' })
    expect(caKineticBlock(alt, null, 'saved', V17)).toMatchObject({ axis: 'z', shaftFaces: ['north', 'south'], impact: { value: 64 }, source: null })
    expect(caKineticBlock(alt, null, 'saved', FABRIC)?.shaftFaces).toEqual(['north'])
    const mill = state('createaddition:rolling_mill', { facing: 'east' })
    expect(caKineticBlock(mill, null, 'saved', V17)).toMatchObject({ axis: 'x', shaftFaces: ['east', 'west'], impact: { value: 8 } })
    expect(caKineticBlock(mill, null, 'saved', FABRIC)?.impact.value).toBe(16)
  })

  it('回らないブロック・向きが読めないブロック・ほかの Mod のブロックは null', () => {
    expect(caKineticBlock(state('createaddition:connector', { facing: 'up', mode: 'none' }), null, 'saved', V17)).toBeNull()
    expect(caKineticBlock(state('createaddition:alternator', { facing: 'sideways' }), null, 'saved', V17)).toBeNull()
    expect(caKineticBlock(state('createaddition:alternator'), null, 'saved', V17)).toBeNull()
    expect(caKineticBlock(state('create:shaft', { facing: 'up' }), null, 'saved', V17)).toBeNull()
  })

  it('Create に渡す表は、設計図の版の値で答える', async () => {
    const bp = blueprintFixture().dataVersion(2975).place([0, 0, 0], 'createaddition:rolling_mill', { facing: 'east' }).toBlueprint()
    const table = await CREATE_ADDITION_KINETICS.load(null, bp)
    expect(table.notes).toEqual([])
    expect(table.block(state('createaddition:rolling_mill', { facing: 'east' }), null, 'saved')?.impact.value).toBe(16)
  })
})

describe('Crafts & Additions の状態と設定', () => {
  it('足りないプロパティだけを補い、書いてある値は変えない', () => {
    expect(completeCaState(state('createaddition:electric_motor'))?.state.properties).toEqual({ facing: 'north', powered: 'false' })
    expect(completeCaState(state('createaddition:connector', { facing: 'up' }))?.state.properties).toEqual({ facing: 'up', mode: 'none' })
    expect(completeCaState(state('createaddition:modular_accumulator'))?.state.properties).toEqual({ top: 'true', bottom: 'true' })
    const full = state('createaddition:alternator', { facing: 'east' })
    expect(completeCaState(full)).toEqual({ state: full, problem: null })
    expect(completeCaState(state('createaddition:alternator', { facing: 'x' }))?.problem).toMatch(/向き（facing）が読めない/)
    expect(completeCaState(state('createaddition:tesla_coil'))).toBeNull()
    expect(completeCaState(state('create:shaft'))).toBeNull()
  })

  it('電気モーターは回転数を変えられる', () => {
    const settings = caBlockSettings(state('createaddition:electric_motor', { facing: 'east' }))
    expect(settings?.fields.map((f) => [f.key, f.min, f.max, f.defaultValue])).toEqual([['ScrollValue', -256, 256, 32]])
    expect(settings?.initialBlockEntity().value.get('id')).toEqual(nbt.string('createaddition:electric_motor'))
    expect(caBlockSettings(state('createaddition:alternator', { facing: 'east' }))).toBeNull()
    expect(caBlockSettings(state('create:creative_motor', { facing: 'east' }))).toBeNull()
  })
})
