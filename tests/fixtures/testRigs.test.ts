// 試験台（testRigs.ts）が、ゲームに置ける形になっていて、計算が考えたとおりに回り・流れることを調べる。
import { describe, expect, it } from 'vitest'
import { runCreateStress } from '../../src/calc/create/createStressPlugin'
import { OUT_OF_RANGE_NOTE } from '../../src/calc/create/kineticGraph'
import { CATALOGS } from '../verification/createBlockCatalog'
import { TEST_RIGS } from './testRigs'

const catalog = CATALOGS.find((c) => c.name === 'create-0.5.1-fabric')!

describe('試験台', () => {
  it('ID が重ならない', () => {
    const ids = TEST_RIGS.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  for (const rig of TEST_RIGS) {
    describe(rig.id, () => {
      it('Create のブロックは、0.5.1 の一覧にあり、blockstates のプロパティをすべて持つ（ほかに持つのは waterlogged だけ）', () => {
        const problems: string[] = []
        for (const r of rig.build().toBlueprint().regions) {
          r.forEachBlock((x, y, z, s) => {
            if (s.id.namespace !== 'create') return
            const entry = catalog.blocks[s.id.toString()]
            if (!entry) {
              problems.push(`${x},${y},${z} ${s.id} は一覧にない`)
              return
            }
            const want = Object.keys(entry.properties)
            const have = Object.keys(s.properties)
            const missing = want.filter((k) => !have.includes(k))
            const extra = have.filter((k) => !want.includes(k) && k !== 'waterlogged')
            if (missing.length || extra.length) problems.push(`${x},${y},${z} ${s.key}：足りない ${missing.join(',')}、余分 ${extra.join(',')}`)
            for (const [k, v] of Object.entries(s.properties)) {
              const values = entry.properties[k]
              if (values && !values.includes(v)) problems.push(`${x},${y},${z} ${s.key}：${k}=${v} はない値`)
            }
          })
        }
        expect(problems).toEqual([])
      })

      it('計算が考えたとおりに回り・流れる（内蔵の初期値）。範囲外の仮定、読めない状態、ゲームで外れる置き方がない', async () => {
        const result = await runCreateStress(rig.build().toBlueprint(), { pack: null, ports: [...(rig.ports ?? [])], mode: 'saved' })
        expect(rig.check(result)).toEqual([])
        expect(result.assumptions.filter((a) => a.message === OUT_OF_RANGE_NOTE)).toEqual([])
        expect(result.issues.filter((i) => i.message.includes('ブロック状態'))).toEqual([])
        expect(result.issues.filter((i) => i.message.includes('設置の規則')).map((i) => i.message), 'ゲームで外れる置き方').toEqual([])
        for (const w of rig.watch) expect(result.probes?.some((p) => p.pos.join() === w.pos.join()), `${w.label} のプローブ`).toBe(true)
      })
    })
  }
})
