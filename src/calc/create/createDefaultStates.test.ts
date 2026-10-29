import { describe, expect, it } from 'vitest'
import { state } from '../../../tests/fixtures/blueprintFixture'
import { completeCreateState, missingAxisMessage } from './createDefaultStates'
import { kineticShape } from './kineticBlocks'

describe('completeCreateState（#149）', () => {
  it('ID だけのシャフト・歯車・ギアボックスは axis=y を補う', () => {
    for (const id of ['create:shaft', 'create:cogwheel', 'create:large_cogwheel', 'create:gearbox', 'create:andesite_encased_shaft']) {
      const r = completeCreateState(state(id))
      expect(r?.state.key).toBe(`${id}[axis=y]`)
      expect(r?.problem).toBeNull()
    }
  })

  it('向きで軸が決まるブロックは facing=north を補う', () => {
    for (const id of ['create:creative_motor', 'create:hand_crank', 'create:water_wheel', 'create:encased_fan', 'create:deployer']) {
      const r = completeCreateState(state(id))
      expect(r?.state.key).toBe(`${id}[facing=north]`)
      expect(kineticShape(r!.state.id.path, r!.state)).not.toBeNull()
    }
  })

  it('利用者が書いた値は変えず、足りないものだけを足す', () => {
    expect(completeCreateState(state('create:shaft', { axis: 'x' }))?.state.key).toBe('create:shaft[axis=x]')
    expect(completeCreateState(state('create:shaft', { waterlogged: 'false' }))?.state.key).toBe(
      'create:shaft[axis=y,waterlogged=false]',
    )
  })

  it('回転軸がなくても形が決まるブロックはそのまま', () => {
    expect(completeCreateState(state('create:millstone'))?.state.key).toBe('create:millstone')
  })

  it('値が読めないときは変えずに理由を返す', () => {
    const s = state('create:shaft', { axis: 'w' })
    const r = completeCreateState(s)
    expect(r?.state).toBe(s)
    expect(r?.problem).toBe(missingAxisMessage(s))
  })

  it('Create の回るブロックでなければ null', () => {
    expect(completeCreateState(state('create:andesite_casing'))).toBeNull()
    expect(completeCreateState(state('minecraft:oak_log'))).toBeNull()
    expect(completeCreateState(state('other:shaft'))).toBeNull()
  })
})
