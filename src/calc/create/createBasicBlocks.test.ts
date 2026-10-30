import { describe, expect, it } from 'vitest'
import { createBuiltinRegistry } from '../builtinPlugins'
import { CREATE_BASIC_BLOCKS } from './createBasicBlocks'
import { kineticShape } from './kineticBlocks'

describe('Create の基本の部品（#162）', () => {
  it('どれも回転軸の決まった状態で、計算で扱える', () => {
    expect(CREATE_BASIC_BLOCKS.length).toBeGreaterThan(10)
    for (const b of CREATE_BASIC_BLOCKS) {
      expect(b.state.id.namespace).toBe('create')
      expect(kineticShape(b.state.id.path, b.state), b.state.key).not.toBeNull()
      expect(b.name).not.toBe('')
    }
  })

  it('シャフトと歯車は縦の軸、モーターは北向き', () => {
    const keys = CREATE_BASIC_BLOCKS.map((b) => b.state.key)
    expect(keys).toContain('create:shaft[axis=y]')
    expect(keys).toContain('create:cogwheel[axis=y]')
    expect(keys).toContain('create:creative_motor[facing=north]')
  })

  it('計算プラグインの一覧から聞ける', () => {
    expect(createBuiltinRegistry().basicBlocks().map((b) => b.state.key)).toEqual(CREATE_BASIC_BLOCKS.map((b) => b.state.key))
  })
})
