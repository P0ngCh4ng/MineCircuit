import { describe, expect, it } from 'vitest'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { nbt } from '../../domain/nbt'
import type { CalcLink } from '../calcPlugin'
import type { VirtualPort } from '../virtualPort'
import { runCreateStress } from './createStressPlugin'

const scroll = (v: number) => nbt.compound({ ScrollValue: nbt.int(v) })
const text = (links: readonly CalcLink[] | undefined, kind: CalcLink['kind']) =>
  (links ?? []).filter((l) => l.kind === kind).map((l) => `${l.from.join(',')}>${l.to.join(',')}`)

function beltLine(rpm: number) {
  return blueprintFixture({ size: [4, 1, 3] })
    .place([0, 0, 0], 'create:creative_motor', { facing: 'south' }, scroll(rpm))
    .place([0, 0, 1], 'create:belt', { facing: 'east', slope: 'horizontal', part: 'start' })
    .place([1, 0, 1], 'create:belt', { facing: 'east', slope: 'horizontal', part: 'middle' })
    .place([2, 0, 1], 'create:belt', { facing: 'east', slope: 'horizontal', part: 'end' })
    .place([3, 0, 1], 'minecraft:chest')
    .toBlueprint()
}

describe('flowLinks（#207）', () => {
  it('回転のつながりと動力源の位置を返す', async () => {
    const bp = blueprintFixture()
      .place([0, 0, 0], 'create:creative_motor', { facing: 'east' }, scroll(16))
      .place([1, 0, 0], 'create:shaft', { axis: 'x' })
      .place([2, 0, 0], 'create:mechanical_press', { facing: 'east' })
      .toBlueprint()
    const result = await runCreateStress(bp, { pack: null, ports: [] })
    expect(text(result.links, 'power').sort()).toEqual(['0,0,0>1,0,0', '1,0,0>2,0,0'])
    expect(result.sources).toEqual([[0, 0, 0]])
    expect(structuredClone(result)).toEqual(result)
  })

  it('仮の動力源は、付けたブロックの位置を動力源にし、つながりには入れない', async () => {
    const bp = blueprintFixture().place([0, 0, 0], 'create:shaft', { axis: 'x' }).place([1, 0, 0], 'create:shaft', { axis: 'x' }).toBlueprint()
    const port: VirtualPort = { id: 'p', pos: [0, 0, 0], pluginId: 'create-stress', kind: 'rotation-source', params: { rpm: 64, capacity: 1024 } }
    const result = await runCreateStress(bp, { pack: null, ports: [port] })
    expect(result.sources).toEqual([[0, 0, 0]])
    expect(text(result.links, 'power')).toEqual(['0,0,0>1,0,0'])
  })

  it('ベルトは物の進む向きにつなぎ、端の先にブロックがあればそこへも', async () => {
    // 軸が X のベルトは、回転数 < 0 で正の向き（east）
    const east = await runCreateStress(beltLine(-32), { pack: null, ports: [] })
    expect(text(east.links, 'item')).toEqual(['0,0,1>1,0,1', '1,0,1>2,0,1', '2,0,1>3,0,1'])
    // 逆に回すと west。端の先（-1）にはブロックがない
    const west = await runCreateStress(beltLine(32), { pack: null, ports: [] })
    expect(text(west.links, 'item')).toEqual(['1,0,1>0,0,1', '2,0,1>1,0,1'])
  })

  it('止まっているベルトには物の向きを付けない', async () => {
    const result = await runCreateStress(beltLine(0), { pack: null, ports: [] })
    expect(text(result.links, 'item')).toEqual([])
  })
})
