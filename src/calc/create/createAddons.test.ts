import { describe, expect, it } from 'vitest'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import type { BlockState } from '../../domain/blockState'
import { resolved } from '../provenance'
import { loadAddonTables, type CreateKineticAddon } from './createAddons'
import { runCreateStress } from './createStressPlugin'

/** テスト用のアドオン。createtest:motor は東向きの動力源（10 RPM、8 SU/RPM）、createtest:load は x 軸の負荷（2 SU/RPM） */
function fakeAddon(loads: string[] = []): CreateKineticAddon {
  return {
    namespace: 'createtest',
    load: async (_pack, bp) => {
      loads.push(bp.name)
      return {
        notes: ['テスト用のアドオンの表を使った'],
        block: (state: BlockState) => {
          if (state.id.path === 'motor') {
            return {
              axis: 'x',
              shaftFaces: ['east'],
              impact: resolved(0, 'builtin'),
              source: { speed: resolved(10, 'blueprint'), capacity: resolved(8, 'builtin') },
              notes: ['テスト用のモーター'],
            }
          }
          if (state.id.path === 'load') {
            return { axis: 'x', shaftFaces: ['east', 'west'], impact: resolved(2, 'builtin'), source: null, notes: [] }
          }
          return null
        },
      }
    },
  }
}

describe('Create のアドオンの表（#276）', () => {
  it('アドオンの動力源と負荷が、Create の回転のネットワークに入る', async () => {
    const bp = blueprintFixture()
      .place([0, 0, 0], 'createtest:motor')
      .place([1, 0, 0], 'create:shaft', { axis: 'x' })
      .place([2, 0, 0], 'createtest:load')
      .place([3, 0, 0], 'createtest:wire')
      .toBlueprint()
    const r = await runCreateStress(bp, { pack: null, ports: [] }, [fakeAddon()])
    expect(r.rotations?.map((x) => [x.pos, x.rpm])).toEqual([
      [[0, 0, 0], 10],
      [[1, 0, 0], 10],
      [[2, 0, 0], 10],
    ])
    const messages = r.assumptions.map((a) => a.message)
    expect(messages).toContain('テスト用のアドオンの表を使った')
    expect(messages).toContain('テスト用のモーター')
    // 表が答えないブロック（createtest:wire）は、追加 Mod として仮定に載せない
    expect(messages.some((m) => m.includes('createtest:wire'))).toBe(false)
    // 使用は負荷の 2 SU/RPM × 10 RPM、供給は 8 SU/RPM × 10 RPM
    expect(r.summary.map((s) => s.value.value).join(' ')).toMatch(/使用 20 SU \/ 供給 80 SU/)
  })

  it('設計図にない namespace の表は読まず、同じ namespace の表は1回だけ読む', async () => {
    const loads: string[] = []
    const withTest = blueprintFixture().name('a').place([0, 0, 0], 'createtest:motor').toBlueprint()
    const without = blueprintFixture().name('b').place([0, 0, 0], 'create:shaft', { axis: 'x' }).toBlueprint()
    expect((await loadAddonTables([fakeAddon(loads), fakeAddon(loads)], withTest, null)).size).toBe(1)
    expect((await loadAddonTables([fakeAddon(loads)], without, null)).size).toBe(0)
    expect(loads).toEqual(['a'])
  })
})
