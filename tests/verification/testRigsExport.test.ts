// 試験台（tests/fixtures/testRigs.ts）を .nbt に書き出し、手順と期待値の表を作る（docs/verification.md「ゲームで測る（D）」）。
// 環境変数を渡したときだけ動く。書き出し先はリポジトリの外にする。
//
//   MINECIRCUIT_RIGS_OUT  書き出すフォルダ。.nbt と「手順.md」を置く
//   MINECIRCUIT_MODPACK   Modpack のフォルダ（任意）。渡すと、期待値をその Modpack の設定とレシピで計算する
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'vitest'
import type { CalcModpack, CalcResult } from '../../src/calc/calcPlugin'
import { runCreateStress } from '../../src/calc/create/createStressPlugin'
import { ModpackLoader } from '../../src/io/modpack/modpackLoader'
import { TEST_RIGS, type TestRig } from '../fixtures/testRigs'
import { NodeFileSource } from './nodeFileSource'

const OUT = process.env.MINECIRCUIT_RIGS_OUT ?? ''
const MODPACK_DIR = process.env.MINECIRCUIT_MODPACK ?? ''

function section(rig: TestRig, result: CalcResult): string {
  const rows = rig.watch.flatMap((w) => {
    const probe = result.probes?.find((p) => p.pos.join() === w.pos.join())
    return (probe?.values ?? []).map((v) => `| ${w.label}（${w.pos.join(', ')}） | ${v.label} | ${v.value.value} |  |`)
  })
  const issues = [...new Set(result.issues.map((i) => i.message))]
  return [
    `## ${rig.title}`,
    '',
    `- ファイル：\`${rig.id}.nbt\`（Issue #${rig.issue}。規則 ${rig.rules.map((r) => `\`${r}\``).join('・')}）`,
    ...(rig.ports?.length ? [`- アプリで同じ値を見るときは、物の入口を ${rig.ports.map((p) => `(${p.pos.join(', ')}) に ${p.items?.item}`).join('、')} で付ける（.nbt には入らない）`] : []),
    '',
    '手順：',
    '',
    ...rig.steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    '| ブロック | 項目 | アプリの期待値 | ゲームで測った値 |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    ...(issues.length ? ['アプリが出す問題：', '', ...issues.map((m) => `- ${m}`), ''] : []),
  ].join('\n')
}

describe.skipIf(!OUT)('試験台の書き出し', () => {
  it('.nbt と手順を書き出す', { timeout: 600_000 }, async () => {
    mkdirSync(OUT, { recursive: true })
    let pack: CalcModpack | null = null
    if (MODPACK_DIR) pack = await new ModpackLoader(new NodeFileSource(MODPACK_DIR)).load()
    const sections = [
      '# ゲームで測る試験台（Create Astral）',
      '',
      '設計図（.nbt）を `schematics` フォルダに入れ、クリエイティブのワールドで置く。期待値は' +
        (MODPACK_DIR ? 'Modpack の設定とレシピで計算したもの。' : 'Create の内蔵の初期値で計算したもの（Modpack なし）。'),
      '測った値を「ゲームで測った値」の列に書く。',
      '',
    ]
    for (const rig of TEST_RIGS) {
      const fx = rig.build()
      writeFileSync(join(OUT, `${rig.id}.nbt`), await fx.toNbtBytes())
      const result = await runCreateStress(fx.toBlueprint(), { pack, ports: [...(rig.ports ?? [])], mode: 'saved' })
      sections.push(section(rig, result))
    }
    writeFileSync(join(OUT, '手順.md'), sections.join('\n'), 'utf8')
  })
})
