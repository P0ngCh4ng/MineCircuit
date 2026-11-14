// 段階 C：実在の設計図を手元で計算に通す（docs/verification.md「実在の設計図で確かめる（C）」）。
// 設計図と Modpack は利用者の PC にあるものを読むだけで、リポジトリには入れない。環境変数を渡したときだけ動く。
//
//   MINECIRCUIT_BLUEPRINTS  設計図（.nbt）のフォルダ。; で区切って複数。中のフォルダも探す
//   MINECIRCUIT_MODPACK     Modpack のフォルダ（任意）。KubeJS のスクリプトは動かさない
//   MINECIRCUIT_REPORT      報告（Markdown）を書き出すファイル（任意）。リポジトリの外に置く
//
// 壊れていること（読めない・計算が止まる・一覧にない ID・おかしな値）はテストを失敗させる。
// 仮定と問題は数を報告に書き、人が見て、おかしな流れ・多すぎる仮定がないかを確かめる。
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CalcContext, CalcModpack, CalcResult } from '../../src/calc/calcPlugin'
import { runCreateStress } from '../../src/calc/create/createStressPlugin'
import type { Blueprint } from '../../src/domain/blueprint'
import type { Vec3 } from '../../src/domain/vec3'
import { ModpackLoader } from '../../src/io/modpack/modpackLoader'
import { readBlueprint } from '../../src/io/readers/readBlueprint'
import { CATALOGS } from './createBlockCatalog'
import { NodeFileSource } from './nodeFileSource'

const BLUEPRINT_DIRS = (process.env.MINECIRCUIT_BLUEPRINTS ?? '').split(';').filter((d) => d.trim() !== '')
const MODPACK_DIR = process.env.MINECIRCUIT_MODPACK ?? ''
const REPORT = process.env.MINECIRCUIT_REPORT ?? ''

/** 1.18.2 より後（1.21.1 の Create 6.0）とみなす DataVersion */
const DATA_VERSION_1_19 = 3105
/** 報告に場所を並べる問題の数 */
const MAX_LISTED = 20

function findBlueprints(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return findBlueprints(path)
    return e.name.toLowerCase().endsWith('.nbt') ? [path] : []
  })
}

/** 設計図の版に合うブロックの一覧 */
function catalogFor(bp: Blueprint) {
  return CATALOGS.find((c) => c.name === (bp.dataVersion < DATA_VERSION_1_19 ? 'create-0.5.1-fabric' : 'create-6.0.10'))!
}

function inside(bp: Blueprint, p: Vec3): boolean {
  const s = bp.size
  return p.every((v, i) => v >= 0 && v < s[i]!)
}

function countBy<T>(items: readonly T[], key: (t: T) => string): [string, number][] {
  const m = new Map<string, number>()
  for (const t of items) m.set(key(t), (m.get(key(t)) ?? 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/** 壊れていることの一覧。空ならよい */
function problems(bp: Blueprint, result: CalcResult): string[] {
  const out: string[] = []
  const catalog = catalogFor(bp)
  const unknown = new Set<string>()
  for (const r of bp.regions) {
    r.forEachBlock((_x, _y, _z, s) => {
      if (s.id.namespace === 'create' && !catalog.blocks[s.id.toString()]) unknown.add(s.id.toString())
    })
  }
  for (const id of unknown) out.push(`${catalog.name} の一覧にない ID：${id}`)
  for (const r of result.rotations ?? []) {
    if (!Number.isFinite(r.rpm)) out.push(`回転数が数でない：${r.pos.join(',')}`)
    if (!inside(bp, r.pos)) out.push(`回転が設計図の外：${r.pos.join(',')}`)
  }
  for (const l of result.links ?? []) {
    if (!inside(bp, l.from) && !inside(bp, l.to)) out.push(`つながりが両端とも設計図の外：${l.from.join(',')} → ${l.to.join(',')}`)
  }
  for (const m of result.itemMoves ?? []) {
    if (!Number.isFinite(m.rate) || m.rate < 0) out.push(`物の流れの数がおかしい：${m.from.join(',')} → ${m.to.join(',')}（${m.rate}）`)
    if (!(m.seconds >= 0) || !(m.hold >= 0)) out.push(`物の動きの時間がおかしい：${m.from.join(',')} → ${m.to.join(',')}`)
  }
  return out
}

/**
 * ゲームが生データに保存した回転数（Speed）と、計算の回転数を比べる。
 * 設計図の外から回されていたブロック（範囲外は空気とみなす）や、保存のあとで変えた設計図では違ってよいので、失敗にはしない
 */
function savedSpeeds(bp: Blueprint, result: CalcResult): { same: number; differ: string[] } {
  let same = 0
  const differ: string[] = []
  for (const r of result.rotations ?? []) {
    const tag = bp.blockEntityAt(r.pos)?.value.get('Speed')
    if (tag?.type !== 'float' && tag?.type !== 'double') continue
    if (Math.abs(tag.value - r.rpm) < 0.01) same++
    else differ.push(`- ${r.pos.join(',')} ${bp.get(r.pos)?.key}：保存 ${tag.value}、計算 ${r.rpm}`)
  }
  return { same, differ }
}

function report(name: string, bp: Blueprint, result: CalcResult): string {
  let blocks = 0
  let create = 0
  for (const r of bp.regions) {
    r.forEachBlock((_x, _y, _z, s) => {
      blocks++
      if (s.id.namespace === 'create') create++
    })
  }
  const rotations = result.rotations ?? []
  const speeds = savedSpeeds(bp, result)
  const lines = [
    `## ${name}`,
    '',
    `- DataVersion ${bp.dataVersion}（${catalogFor(bp).name}）、大きさ ${bp.size.join('×')}、ブロック ${blocks}（Create ${create}）`,
    `- 回るブロック ${rotations.length}（止まっている ${rotations.filter((r) => r.rpm === 0).length}、過負荷 ${rotations.filter((r) => r.overloaded).length}）、動力源 ${result.sources?.length ?? 0}`,
    `- 物のつながり ${(result.links ?? []).filter((l) => l.kind === 'item').length}、物の動き ${(result.itemMoves ?? []).length}`,
    `- 保存された回転数（Speed）と計算が同じ ${speeds.same}、違う ${speeds.differ.length}`,
    ...speeds.differ.slice(0, MAX_LISTED).map((d) => `  ${d}`),
    '',
    '| まとめ | 値 | 出どころ |',
    '| --- | --- | --- |',
    ...result.summary.filter((s) => !s.network).map((s) => `| ${s.label} | ${s.value.value} | ${s.value.source} |`),
    '',
    '| 問題 | 重さ | 数 |',
    '| --- | --- | --- |',
    ...countBy(result.issues, (i) => `${i.message}\t${i.severity ?? 'error'}`).map(([k, n]) => `| ${k.split('\t')[0]} | ${k.split('\t')[1]} | ${n} |`),
    '',
    // 問題の場所（多いときは先頭だけ）。おかしな判定でないかを人が見るため
    ...result.issues.slice(0, MAX_LISTED).map((i) => `- ${i.pos.join(',')} ${bp.get(i.pos)?.key ?? '（空き）'}：${i.message}`),
    '',
    '| 仮定 | 数 |',
    '| --- | --- |',
    ...countBy(result.assumptions, (a) => a.message).map(([k, n]) => `| ${k} | ${n} |`),
    '',
  ]
  return lines.join('\n')
}

describe.skipIf(BLUEPRINT_DIRS.length === 0)('実在の設計図（段階 C）', () => {
  it('どの設計図も読めて、計算が止まらず、一覧にない ID もおかしな値もない', { timeout: 600_000 }, async () => {
    let pack: CalcModpack | null = null
    if (MODPACK_DIR) pack = await new ModpackLoader(new NodeFileSource(MODPACK_DIR)).load()
    const ctx: CalcContext = { pack, ports: [] }
    const sections = [`# 実在の設計図の計算（段階 C）`, '', `Modpack：${MODPACK_DIR ? 'あり' : 'なし'}`, '']
    const failures: string[] = []
    for (const dir of BLUEPRINT_DIRS) {
      for (const file of findBlueprints(dir)) {
        const name = relative(dir, file)
        let bp: Blueprint
        let result: CalcResult
        try {
          bp = await readBlueprint(name, readFileSync(file))
          result = await runCreateStress(bp, ctx)
        } catch (e) {
          failures.push(`${name}：${e instanceof Error ? e.message : String(e)}`)
          continue
        }
        failures.push(...problems(bp, result).map((p) => `${name}：${p}`))
        sections.push(report(name, bp, result))
      }
    }
    if (REPORT) writeFileSync(REPORT, sections.join('\n'), 'utf8')
    expect(failures).toEqual([])
  })
})
