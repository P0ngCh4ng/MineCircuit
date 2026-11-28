// 物の通り道を、たどるブロックのすべての状態で確かめる（docs/create-verification.md「2. 状態の組み合わせ」）。
// ブロックを真ん中に置いて6つの面にチェストを並べ、ブロックに物の入口を付ける。回るブロックなら仮の動力源（64 RPM）も付ける。
// 期待値はコードの式をなぞらず、「設計図ごとまわす・反転すると、物のつながりも同じだけ動く」という性質で書く。
// この置き方で物が流れないブロック（デポ・ベルトのファンネル・トンネル・機械など）は createItemPathLayouts.test.ts で確かめる。
import { describe, expect, it } from 'vitest'
import type { CalcResult } from '../../src/calc/calcPlugin'
import { runCreateStress } from '../../src/calc/create/createStressPlugin'
import { transformCreateState } from '../../src/calc/create/createTransform'
import { CREATE_STRESS_PLUGIN_ID, ITEM_INPUT_PORT_KIND } from '../../src/calc/create/kineticGraph'
import type { VirtualPort } from '../../src/calc/virtualPort'
import type { BlockState } from '../../src/domain/blockState'
import type { BlockTransform } from '../../src/domain/blockTransform'
import { kineticShape } from '../../src/calc/create/kineticBlocks'
import type { Vec3 } from '../../src/domain/vec3'
import { blueprintFixture } from '../fixtures/blueprintFixture'
import { CATALOGS, stateCombinations } from './createBlockCatalog'
import { FLOWS_HERE, itemLinks, rpmSign, tracedBlocks } from './itemPathCompare'

const CENTER: Vec3 = [1, 1, 1]
const NEIGHBORS: readonly Vec3[] = [
  [0, 1, 1],
  [2, 1, 1],
  [1, 0, 1],
  [1, 2, 1],
  [1, 1, 0],
  [1, 1, 2],
]
const CHEST = { facing: 'north', type: 'single', waterlogged: 'false' }

const TRANSFORMS: readonly { name: string; t: BlockTransform }[] = [
  { name: '90°', t: { translate: [0, 0, 0], quarterTurns: 1, mirror: 'none', pivot: CENTER } },
  { name: 'x の反転', t: { translate: [0, 0, 0], quarterTurns: 0, mirror: 'x', pivot: CENTER } },
]

const PORT: VirtualPort = {
  id: 'input',
  pos: CENTER,
  pluginId: CREATE_STRESS_PLUGIN_ID,
  kind: ITEM_INPUT_PORT_KIND,
  params: { rate: 1 },
  items: { item: 'minecraft:cobblestone' },
}

const RPM = 64

async function run(state: BlockState, rpm: number): Promise<CalcResult> {
  const fx = blueprintFixture({ size: [3, 3, 3] }).place(CENTER, state)
  for (const n of NEIGHBORS) fx.place(n, 'minecraft:chest', CHEST)
  const ports: VirtualPort[] = [PORT]
  if (kineticShape(state.id.path, state)) {
    ports.push({ id: 'source', pos: CENTER, pluginId: CREATE_STRESS_PLUGIN_ID, kind: 'rotation-source', params: { rpm, capacity: Number.MAX_SAFE_INTEGER } })
  }
  return runCreateStress(fx.toBlueprint(), { pack: null, ports, mode: 'saved' })
}

for (const c of CATALOGS) {
  describe(`${c.name}：物の通り道の状態の組み合わせ`, () => {
    const blocks = tracedBlocks().filter((id) => c.blocks[id])

    it('たどるブロックがある', () => {
      expect(blocks.length).toBeGreaterThan(20)
    })

    it('すべての状態で計算が止まらず、設計図ごとまわす・反転すると、物のつながりも同じだけ動く', { timeout: 600_000 }, async () => {
      const problems: string[] = []
      let states = 0
      let withLinks = 0
      const flowing = new Map<string, number>()
      for (const id of blocks) {
        flowing.set(id, 0)
        for (const s of stateCombinations(id, c.blocks[id]!)) {
          const before = await run(s, RPM)
          states++
          if (itemLinks(before).length) {
            withLinks++
            flowing.set(id, flowing.get(id)! + 1)
          }
          for (const { name, t } of TRANSFORMS) {
            const moved = transformCreateState(s, t) ?? s
            const after = await run(moved, RPM * rpmSign(s, t))
            const want = itemLinks(before, t)
            const got = itemLinks(after)
            if (want.join(' ') !== got.join(' ')) problems.push(`${id}：${name} で [${want.join(' ')}] でなく [${got.join(' ')}]（${s.key} → ${moved.key}）`)
          }
        }
      }
      expect(problems.slice(0, 40)).toEqual([])
      // 物がどこにも行かないと、この確かめ方は効かない。この置き方で流れるはずのブロックは、どこかの状態で流れること
      expect(
        FLOWS_HERE.filter((id) => c.blocks[id] && !flowing.get(id)),
        `${withLinks} / ${states} の状態で物が流れる`,
      ).toEqual([])
    })
  })
}
