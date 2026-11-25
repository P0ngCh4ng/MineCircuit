// 物の通り道を、たどるブロックのすべての状態で確かめる（docs/create-verification.md「2. 状態の組み合わせ」）。
// ブロックを真ん中に置いて6つの面にチェストを並べ、ブロックに物の入口を付ける。回るブロックなら仮の動力源（64 RPM）も付ける。
// 期待値はコードの式をなぞらず、「設計図ごとまわす・反転すると、物のつながりも同じだけ動く」という性質で書く。
import { describe, expect, it } from 'vitest'
import type { CalcResult } from '../../src/calc/calcPlugin'
import { runCreateStress } from '../../src/calc/create/createStressPlugin'
import { transformCreateState } from '../../src/calc/create/createTransform'
import { CREATE_STRESS_PLUGIN_ID, ITEM_INPUT_PORT_KIND } from '../../src/calc/create/kineticGraph'
import type { VirtualPort } from '../../src/calc/virtualPort'
import type { BlockState } from '../../src/domain/blockState'
import { transformDirection, transformPos, type BlockTransform } from '../../src/domain/blockTransform'
import { DIRECTIONS } from '../../src/domain/direction'
import { axisDirections, kineticShape } from '../../src/calc/create/kineticBlocks'
import type { Vec3 } from '../../src/domain/vec3'
import { blueprintFixture } from '../fixtures/blueprintFixture'
import { blockEntityTypes, CATALOGS, stateCombinations } from './createBlockCatalog'
import { ITEM_PATH_ROLES } from './itemPathRoles'

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

/**
 * まわした・反転したあとも同じ向きに回るための、仮の動力源の回転数の符号。
 * 回転数は「軸の正の向きから見て」なので、軸の正の向きが負の向きに移れば符号が変わる。反転は回る向きを逆にする
 */
function rpmSign(state: BlockState, t: BlockTransform): number {
  const shape = kineticShape(state.id.path, state)
  if (!shape) return 1
  const moved = transformDirection(t, axisDirections(shape.axis)[0])
  const positive = DIRECTIONS.indexOf(moved) % 2 === 1
  return (positive ? 1 : -1) * (t.mirror === 'none' ? 1 : -1)
}

const key = (v: Vec3) => v.join(',')

/** 物のつながり（from → to）。move で位置を動かしてから並べる */
function itemLinks(r: CalcResult, move: (v: Vec3) => Vec3 = (v) => v): string[] {
  return (r.links ?? [])
    .filter((l) => l.kind === 'item')
    .map((l) => `${key(move(l.from))}→${key(move(l.to))}`)
    .sort()
}

/**
 * この置き方（真ん中のブロックと6つのチェスト）で物が流れるはずのブロック。
 * ほかは、物を持つだけ（デポなど）、ベルトの上でないと働かない（ベルトのファンネル・トンネル）、
 * レシピがないと何も出さない（機械）ので、ここでは流れない。docs/create-verification.md「まだ仕組みがないもの」
 */
const FLOWS_HERE = ['create:belt', 'create:andesite_funnel', 'create:brass_funnel', 'create:chute', 'create:smart_chute', 'create:weighted_ejector']

/** 物の通り道でたどるブロック（ITEM_PATH_ROLES が traced の種類のブロック） */
function tracedBlocks(): string[] {
  const ids = new Set<string>()
  for (const [type, blocks] of blockEntityTypes()) {
    if (ITEM_PATH_ROLES[type.replace(/^create:/, '')]?.role === 'traced') for (const b of blocks) ids.add(b)
  }
  return [...ids].sort()
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
            const want = itemLinks(before, (v) => transformPos(t, v))
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
