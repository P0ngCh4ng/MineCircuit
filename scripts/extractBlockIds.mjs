// Mod の jar から、ブロックの ID と、ブロック状態のプロパティの値の範囲だけを取り出す（docs/verification.md「1. ブロックの一覧」）。
// 取り出すのは名前だけ。モデル・テクスチャ・翻訳は取らない。
// 使い方：node scripts/extractBlockIds.mjs <jar> <namespace> <出力の .json>
// 例：node scripts/extractBlockIds.mjs ".../create-1.21.1-6.0.10.jar" create tests/verification/blocks/create-6.0.10.json
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'

const [jarPath, namespace, outPath] = process.argv.slice(2)
if (!jarPath || !namespace || !outPath) {
  console.error('使い方：node scripts/extractBlockIds.mjs <jar> <namespace> <出力の .json>')
  process.exit(1)
}

const prefix = `assets/${namespace}/blockstates/`
const files = unzipSync(readFileSync(jarPath), {
  filter: (f) => f.name.startsWith(prefix) && f.name.endsWith('.json') && !f.name.slice(prefix.length).includes('/'),
})

/** "a=1,b=2" の形のキーから値を集める */
function addVariantKey(props, key) {
  if (key === '' || key === 'normal') return
  for (const part of key.split(',')) {
    const [name, value] = part.split('=')
    if (name && value !== undefined) add(props, name, value)
  }
}

/** multipart の when（{a: "1|2"}、{OR: [...]}、{AND: [...]}）から値を集める */
function addWhen(props, when) {
  if (!when || typeof when !== 'object') return
  for (const [name, value] of Object.entries(when)) {
    if (name === 'OR' || name === 'AND') {
      for (const w of value) addWhen(props, w)
    } else {
      for (const v of String(value).split('|')) add(props, name, v)
    }
  }
}

function add(props, name, value) {
  ;(props[name] ??= new Set()).add(value)
}

const blocks = {}
for (const [name, bytes] of Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1))) {
  const id = `${namespace}:${name.slice(prefix.length, -'.json'.length)}`
  const json = JSON.parse(strFromU8(bytes))
  const props = {}
  let kind = 'variants'
  if (json.variants) {
    for (const key of Object.keys(json.variants)) addVariantKey(props, key)
  } else if (json.multipart) {
    kind = 'multipart'
    for (const part of json.multipart) addWhen(props, part.when)
  }
  const sorted = {}
  for (const p of Object.keys(props).sort()) sorted[p] = [...props[p]].sort()
  blocks[id] = { kind, properties: sorted }
}

const out = {
  // どの jar から取り出したか。jar 自体はリポジトリに入れない
  source: basename(jarPath),
  namespace,
  // multipart のブロックは、見た目に関わらないプロパティが blockstates に出てこないので、値の範囲が欠けることがある
  blocks,
}
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n')
console.log(`${Object.keys(blocks).length} 個のブロックを ${outPath} に書いた`)
