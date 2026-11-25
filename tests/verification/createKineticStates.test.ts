// 回転の形（回転軸・軸の口・歯車・面の係数・チェーン・ガントリー）を、回るブロックのすべての状態で確かめる
// （docs/create-verification.md「2. 状態の組み合わせ」）。
// 期待値はコードの式をなぞらず、「ブロックをまわす・反転すると、形も同じだけまわる」という性質で書く。
import { describe, expect, it } from 'vitest'
import type { BlockState } from '../../src/domain/blockState'
import { transformDirection, type BlockTransform } from '../../src/domain/blockTransform'
import { DIRECTIONS, type Direction } from '../../src/domain/direction'
import { transformCreateState } from '../../src/calc/create/createTransform'
import { axisDirections, directionAxis, isKineticBlock, kineticShape, type KineticShape } from '../../src/calc/create/kineticBlocks'
import { CATALOGS, stateCombinations } from './createBlockCatalog'

const TRANSFORMS: readonly { name: string; t: BlockTransform }[] = [
  { name: '90°', t: { translate: [0, 0, 0], quarterTurns: 1, mirror: 'none', pivot: [0, 0, 0] } },
  { name: '180°', t: { translate: [0, 0, 0], quarterTurns: 2, mirror: 'none', pivot: [0, 0, 0] } },
  { name: '270°', t: { translate: [0, 0, 0], quarterTurns: 3, mirror: 'none', pivot: [0, 0, 0] } },
  { name: 'x の反転', t: { translate: [0, 0, 0], quarterTurns: 0, mirror: 'x', pivot: [0, 0, 0] } },
  { name: 'z の反転', t: { translate: [0, 0, 0], quarterTurns: 0, mirror: 'z', pivot: [0, 0, 0] } },
]

const sortFaces = (faces: readonly Direction[]) => [...faces].sort().join(',')

/**
 * 形を t で動かしたもの（比べる項目だけ）。
 * 回転数の符号は「軸の正の向きから見て」で決まるので、軸の正の向きが負の向きに移る軸の面は、係数の符号が変わる。
 * 反転は回る向きを全部逆にする。全体の符号が逆でも同じ回り方なので、軸の口の最初の面が正になるようにそろえて比べる
 */
function movedShape(s: KineticShape, t: BlockTransform) {
  const move = (d: Direction) => transformDirection(t, d)
  const chain = s.chain && {
    axis: directionAxis(move(axisDirections(s.chain.connectionAxis)[0])),
    faces: sortFaces([
      ...(s.chain.positive ? [move(axisDirections(s.chain.connectionAxis)[0])] : []),
      ...(s.chain.negative ? [move(axisDirections(s.chain.connectionAxis)[1])] : []),
    ]),
  }
  const flips = (d: Direction) => (DIRECTIONS.indexOf(move(axisDirections(directionAxis(d))[0])) % 2 === 1 ? 1 : -1)
  const factors = new Map(DIRECTIONS.map((d) => [move(d), (s.faceFactors?.[d] ?? 1) * flips(d)]))
  const faces = s.shaftFaces.map(move)
  return {
    axis: directionAxis(move(axisDirections(s.axis)[0])),
    faces: sortFaces(s.shaftFaces.map(move)),
    cog: s.cog,
    factors: normalizedFactors(faces, (d) => factors.get(d)!),
    chain,
    gantry: s.gantry && { ...s.gantry, facing: move(s.gantry.facing) },
  }
}

function plainShape(s: KineticShape) {
  const chain = s.chain && {
    axis: s.chain.connectionAxis,
    faces: sortFaces([
      ...(s.chain.positive ? [axisDirections(s.chain.connectionAxis)[0]] : []),
      ...(s.chain.negative ? [axisDirections(s.chain.connectionAxis)[1]] : []),
    ]),
  }
  return {
    axis: s.axis,
    faces: sortFaces(s.shaftFaces),
    cog: s.cog,
    factors: normalizedFactors(s.shaftFaces, (d) => s.faceFactors?.[d] ?? 1),
    chain,
    gantry: s.gantry,
  }
}

/** 軸の口の面の係数を、最初の面（DIRECTIONS の順）が正になるようにそろえる */
function normalizedFactors(faces: readonly Direction[], f: (d: Direction) => number): string {
  const sorted = DIRECTIONS.filter((d) => faces.includes(d))
  const sign = sorted.length ? Math.sign(f(sorted[0]!)) || 1 : 1
  return sorted.map((d) => `${d}:${f(d) * sign}`).join(',')
}

const path = (s: BlockState) => s.id.path

/**
 * まわす・反転すると形がそろわないと分かっているもの。ブロック状態と変え方から、理由を返す。
 * 一覧は docs/create-verification.md「見つかったこと」にも書く
 */
function knownGap(s: BlockState, transform: string): string | null {
  const p = path(s)
  if ((p === 'clutch' && s.properties.powered === 'true') || p === 'sequenced_gearshift') {
    return 'ゲームは回転が入ってきた側を残して反対側を切るが、計算はいつも軸の正の側を残す（ST-FACE-CLUTCH・ST-FACE-SEQUENCED-GEARSHIFT）。切れる側が違っても、違うのはこのブロック自身の回転数だけ'
  }
  if (p === 'hose_pulley' && transform.endsWith('反転')) {
    return '軸の口は向きの時計回りの面にだけある。反転しても向きの値は鏡に映した向きになるだけなので、ゲームでも軸の口が反対側に移る'
  }
  return null
}

for (const c of CATALOGS) {
  describe(`${c.name}：回る形の状態の組み合わせ`, () => {
    const kinetic = Object.entries(c.blocks).filter(([id]) => id.startsWith('create:') && isKineticBlock(id.slice('create:'.length)))

    it('回るブロックがある', () => {
      expect(kinetic.length).toBeGreaterThan(50)
    })

    it('すべての状態で、まわす・反転すると、回転軸・軸の口・歯車・面の係数・チェーン・ガントリーの向きも同じだけ動く', () => {
      const problems = new Set<string>()
      for (const [id, block] of kinetic) {
        for (const s of stateCombinations(id, block)) {
          const shape = kineticShape(path(s), s)
          for (const { name, t } of TRANSFORMS) {
            if (knownGap(s, name)) continue
            const moved = transformCreateState(s, t) ?? s
            const after = kineticShape(path(moved), moved)
            if (!shape || !after) {
              if (!shape !== !after) problems.add(`${id}：${name} で形が ${shape ? 'なくなる' : 'できる'}（${s.key} → ${moved.key}）`)
              continue
            }
            const want = movedShape(shape, t)
            const got = plainShape(after)
            for (const k of Object.keys(want) as (keyof typeof want)[]) {
              if (JSON.stringify(want[k]) !== JSON.stringify(got[k])) {
                problems.add(`${id} ${k}：${name} で ${JSON.stringify(want[k])} でなく ${JSON.stringify(got[k])}（${s.key} → ${moved.key}）`)
              }
            }
          }
        }
      }
      expect([...problems].sort()).toEqual([])
    })

    it('回るブロックは、回転軸を決めるプロパティがそろっていれば、どの状態でも形が決まる', () => {
      const problems: string[] = []
      for (const [id, block] of kinetic) {
        for (const s of stateCombinations(id, block)) if (!kineticShape(path(s), s)) problems.push(`${id}：${s.key}`)
      }
      expect(problems.slice(0, 40)).toEqual([])
    })
  })
}
