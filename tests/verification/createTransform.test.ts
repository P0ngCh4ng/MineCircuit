// 回転・反転を、すべてのブロックの、プロパティのとりうる値で確かめる（docs/verification.md「2. 状態の組み合わせ」）。
// 期待値はコードの式をなぞらず、回転と反転の性質（4回で元に戻る、値の範囲を出ない、向きが変わる）で書く。
import { describe, expect, it } from 'vitest'
import type { BlockTransform, MirrorAxis, QuarterTurns } from '../../src/domain/blockTransform'
import { BlockState } from '../../src/domain/blockState'
import { ResourceLocation } from '../../src/domain/resourceLocation'
import { transformCreateState } from '../../src/calc/create/createTransform'
import { CATALOGS, type CatalogBlock } from './createBlockCatalog'

/** 全組み合わせがこれより多いブロックは、プロパティを1つずつ変える（ほかは最初の値） */
const MAX_COMBINATIONS = 4096
const HORIZONTAL = ['north', 'east', 'south', 'west']

const turn = (q: QuarterTurns): BlockTransform => ({ translate: [0, 0, 0], quarterTurns: q, mirror: 'none', pivot: [0, 0, 0] })
const mirror = (m: MirrorAxis): BlockTransform => ({ translate: [0, 0, 0], quarterTurns: 0, mirror: m, pivot: [0, 0, 0] })
const apply = (s: BlockState, t: BlockTransform) => transformCreateState(s, t) ?? s

/** プロパティの値の組み合わせ */
export function stateCombinations(id: string, block: CatalogBlock): BlockState[] {
  const rl = ResourceLocation.parse(id)
  const names = Object.keys(block.properties)
  const total = names.reduce((n, p) => n * block.properties[p]!.length, 1)
  if (total <= MAX_COMBINATIONS) {
    let combos: Record<string, string>[] = [{}]
    for (const p of names) combos = combos.flatMap((c) => block.properties[p]!.map((v) => ({ ...c, [p]: v })))
    return combos.map((c) => new BlockState(rl, c))
  }
  const base = Object.fromEntries(names.map((p) => [p, block.properties[p]![0]!]))
  return names.flatMap((p) => block.properties[p]!.map((v) => new BlockState(rl, { ...base, [p]: v })))
}

/** 分かっている抜け："id プロパティ" → 理由 */
const KNOWN_TRANSFORM_GAPS: Readonly<Record<string, string>> = {}

for (const c of CATALOGS) {
  describe(`${c.name}：回転・反転`, () => {
    const problems = (check: (id: string, block: CatalogBlock, s: BlockState) => string | null) => {
      const out = new Set<string>()
      for (const [id, block] of Object.entries(c.blocks)) {
        for (const s of stateCombinations(id, block)) {
          const p = check(id, block, s)
          if (p && !KNOWN_TRANSFORM_GAPS[p.split('：')[0]!]) out.add(p)
        }
      }
      return [...out].sort()
    }

    it('4回まわすと元に戻る。反転を2回すると元に戻る。2回まわすのは、1回を2回と同じ', () => {
      expect(
        problems((id, _b, s) => {
          let r = s
          for (let i = 0; i < 4; i++) r = apply(r, turn(1))
          if (!r.equals(s)) return `${id}：4回まわすと ${s.key} → ${r.key}`
          for (const m of ['x', 'z'] as const) {
            const back = apply(apply(s, mirror(m)), mirror(m))
            if (!back.equals(s)) return `${id}：${m} の反転2回で ${s.key} → ${back.key}`
          }
          const twice = apply(apply(s, turn(1)), turn(1))
          if (!apply(s, turn(2)).equals(twice)) return `${id}：2回まわすのと1回を2回で違う ${s.key}`
          return null
        }),
      ).toEqual([])
    })

    it('まわしても反転しても、プロパティの名前は変わらず、値はとりうる範囲を出ない', () => {
      expect(
        problems((id, block, s) => {
          for (const t of [turn(1), turn(2), turn(3), mirror('x'), mirror('z')]) {
            const r = apply(s, t)
            const keys = Object.keys(r.properties).sort().join(',')
            if (keys !== Object.keys(s.properties).sort().join(',')) return `${id}：プロパティが変わる ${s.key} → ${r.key}`
            for (const [p, v] of Object.entries(r.properties)) {
              // multipart は値の範囲が欠けることがあるので、範囲の外の値は調べない
              if (block.kind === 'variants' && !block.properties[p]!.includes(v)) return `${id} ${p}：範囲の外の値 ${v}（${s.key}）`
            }
          }
          return null
        }),
      ).toEqual([])
    })

    it('東西南北の値をとるプロパティは、90° まわすと値が変わる', () => {
      expect(
        problems((id, block, s) => {
          const r = apply(s, turn(1))
          for (const [p, values] of Object.entries(block.properties)) {
            if (!HORIZONTAL.every((h) => values.includes(h))) continue
            const v = s.properties[p]!
            if (HORIZONTAL.includes(v) && r.properties[p] === v) return `${id} ${p}：90° まわしても ${v} のまま`
          }
          return null
        }),
      ).toEqual([])
    })
  })
}
