import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { fakeJar } from '../../../tests/fixtures/fakeJar'
import { BlockState } from '../../domain/blockState'
import { ResourceLocation } from '../../domain/resourceLocation'
import { scanJar } from '../../io/modpack/jarScanner'
import { Modpack } from '../../io/modpack/modpack'
import { NO_ROTATION_MESSAGE, useBrushStore } from './brushStore'
import { useModpackContentStore } from './modpackContent'

const state = (id: string, properties: Record<string, string> = {}) =>
  new BlockState(ResourceLocation.parse(id), properties)

function horizontalOnlyPack(): Modpack {
  const variants: Record<string, { model: string }> = {}
  for (const f of ['north', 'east', 'south', 'west']) variants[`facing=${f}`] = { model: 'test:block/x' }
  return new Modpack([scanJar('test.jar', fakeJar({ blockStates: { 'test:machine': { variants } } }))], null)
}

describe('useBrushStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('置くブロックがなければ R は何もしない', () => {
    const brush = useBrushStore()
    expect(brush.rotate(false)).toBe(false)
    expect(brush.message).toBeNull()
  })

  it('回すと state が変わる。回せなければ知らせを出し、次の操作で消す', () => {
    const brush = useBrushStore()
    brush.setFromBlock(state('create:shaft', { axis: 'x' }))
    expect(brush.rotate(false)).toBe(true)
    expect(brush.state?.key).toBe('create:shaft[axis=z]')

    brush.setFromBlock(state('minecraft:stone'))
    expect(brush.rotate(false)).toBe(false)
    expect(brush.message).toBe(NO_ROTATION_MESSAGE)
    brush.setFromBlock(state('create:shaft', { axis: 'x' }))
    expect(brush.message).toBeNull()
  })

  it('Modpack を読んでいれば、その定義の範囲で回す。読み終えたら選び直さなくても効く', async () => {
    const content = useModpackContentStore()
    const brush = useBrushStore()
    brush.setFromBlock(state('test:machine', { facing: 'north' }))
    content.pack = horizontalOnlyPack()
    await nextTick()
    expect(brush.rotate(true)).toBe(false)
    expect(brush.message).toBe(NO_ROTATION_MESSAGE)

    content.pack = null
    await nextTick()
    expect(brush.rotate(true)).toBe(true)
    expect(brush.state?.properties.facing).toBe('up')
  })
})
