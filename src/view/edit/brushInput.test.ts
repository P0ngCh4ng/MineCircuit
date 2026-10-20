import { describe, expect, it } from 'vitest'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { blueprintBlockStates, BrushInputError, parseBlockStateInput } from './brushInput'

describe('parseBlockStateInput', () => {
  it('ID と properties を読む。namespace を省くと minecraft', () => {
    expect(parseBlockStateInput('create:shaft')?.key).toBe('create:shaft')
    expect(parseBlockStateInput(' create:shaft[axis=y, waterlogged=false] ')?.key).toBe(
      'create:shaft[axis=y,waterlogged=false]',
    )
    expect(parseBlockStateInput('stone')?.key).toBe('minecraft:stone')
    expect(parseBlockStateInput('create:shaft[]')?.key).toBe('create:shaft')
    expect(parseBlockStateInput('   ')).toBeNull()
  })

  it('形が正しくなければ、直し方を書いたエラーにする', () => {
    for (const bad of ['create:', 'a:b:c', 'create:shaft[axis=y', 'create:shaft[axis]', 'create:shaft[=y]', 'create: shaft']) {
      expect(() => parseBlockStateInput(bad), bad).toThrow(BrushInputError)
    }
  })
})

describe('blueprintBlockStates', () => {
  it('パレットのブロック状態を、空気を除き key の順に返す', () => {
    const bp = blueprintFixture({ size: [3, 1, 1] })
      .place([0, 0, 0], 'minecraft:stone')
      .place([1, 0, 0], 'create:shaft', { axis: 'x' })
      .place([2, 0, 0], 'create:shaft', { axis: 'x' })
      .paletteState('minecraft:air')
      .toBlueprint()
    expect(blueprintBlockStates(bp).map((s) => s.key)).toEqual(['create:shaft[axis=x]', 'minecraft:stone'])
  })
})
