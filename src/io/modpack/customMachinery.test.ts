import { describe, expect, it } from 'vitest'
import { strToU8 } from 'fflate'
import { MemoryFileSource } from '../memoryFileSource'
import { machineAppearanceBlock, readMachineAppearances } from './customMachinery'

const machine = (block: string) => strToU8(JSON.stringify({ name: 'x', appearance: { block, running: { block: 'other:on' } } }))

describe('readMachineAppearances', () => {
  it('kubejs/data と datapacks の <ns>/machines/ から、機械の ID と見た目のブロックを読む', async () => {
    const source = new MemoryFileSource([
      ['kubejs/data/createastral/machines/distillery.json', machine('createastral:distillery_dummy')],
      ['kubejs/data/createastral/machines/sub/washer.json', machine('createastral:washer_dummy')],
      ['kubejs/data/createastral/recipes/r.json', machine('not:a_machine')],
      ['datapacks/pack/data/astral/machines/turbine.json', machine('astral:turbine[active=false]')],
      ['datapacks/pack/data/astral/machines/broken.json', strToU8('{ not json')],
      ['datapacks/pack/data/astral/machines/noappearance.json', strToU8('{}')],
    ])
    const { machines, problems } = await readMachineAppearances(source)
    expect(machines).toEqual({
      'createastral:distillery': 'createastral:distillery_dummy',
      'createastral:sub/washer': 'createastral:washer_dummy',
      'astral:turbine': 'astral:turbine[active=false]',
    })
    expect(problems).toEqual(['datapacks/pack/data/astral/machines/broken.json: 機械の定義を JSON として読めません'])
  })

  it('フォルダがなければ空', async () => {
    expect(await readMachineAppearances(new MemoryFileSource([['mods/a.jar', new Uint8Array()]]))).toEqual({ machines: {}, problems: [] })
  })

  it('appearance.block がなければ null', () => {
    expect(machineAppearanceBlock({ appearance: { model: 'a:b' } })).toBeNull()
    expect(machineAppearanceBlock(null)).toBeNull()
  })
})
