import { describe, expect, it } from 'vitest'
import { BlockState } from '../domain/blockState'
import { ResourceLocation } from '../domain/resourceLocation'
import { propertyChoices } from './propertyChoices'

const state = (id: string, props: Record<string, string>) => new BlockState(ResourceLocation.parse(id), props)

describe('propertyChoices（ブロック状態の値の候補。#165）', () => {
  it('Modpack がなければ、よく使う項目だけ一般の値を出し、分からない項目は null', () => {
    const choices = propertyChoices(
      state('create:gearbox', { axis: 'x', facing: 'up', horizontal_facing: 'west', powered: 'false', mode: 'fast' }),
      null,
    )
    expect(choices).toEqual([
      { name: 'axis', current: 'x', values: ['x', 'y', 'z'] },
      { name: 'facing', current: 'up', values: ['down', 'up', 'north', 'south', 'west', 'east'] },
      { name: 'horizontal_facing', current: 'west', values: ['north', 'east', 'south', 'west'] },
      { name: 'powered', current: 'false', values: ['true', 'false'] },
      { name: 'mode', current: 'fast', values: null },
    ])
  })

  it('Modpack の定義の値を優先する。今の値が候補になければ先頭に入れる', () => {
    const choices = propertyChoices(state('create:shaft', { axis: 'w', mode: 'fast' }), {
      axis: ['x', 'y'],
      mode: ['slow', 'fast'],
    })
    expect(choices).toEqual([
      { name: 'axis', current: 'w', values: ['w', 'x', 'y'] },
      { name: 'mode', current: 'fast', values: ['slow', 'fast'] },
    ])
  })
})
