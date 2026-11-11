// Create のソースから、ブロックごとのブロックエンティティ（種類・クラス・回るか）と応力の初期値を取り出し、
// scripts/extractBlockIds.mjs が作ったブロックの一覧に書き足す（docs/verification.md「1. ブロックの一覧」）。
// 取り出すのは名前と数値だけ。Create は MIT License。
// 使い方：node scripts/extractCreateSource.mjs <Create のソースの根> <ブロックの一覧の .json> <出典の説明>
// 例：node scripts/extractCreateSource.mjs ./Create tests/verification/blocks/create-6.0.10.json "Creators-of-Create/Create 7ff2760"
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const [root, listPath, sourceLabel] = process.argv.slice(2)
if (!root || !listPath || !sourceLabel) {
  console.error('使い方：node scripts/extractCreateSource.mjs <Create のソースの根> <ブロックの一覧の .json> <出典の説明>')
  process.exit(1)
}

/** クラス名 → ソース */
const java = new Map()
;(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (name.endsWith('.java')) java.set(basename(name, '.java'), readFileSync(p, 'utf8'))
  }
})(root)

const list = JSON.parse(readFileSync(listPath, 'utf8'))
const allIds = Object.keys(list.blocks)
const need = (name) => {
  const src = java.get(name)
  if (!src) throw new Error(`${name}.java が見つかりません`)
  return src
}

// ---- AllBlocks の定数 → ID と、応力の初期値 ----
const allBlocks = need('AllBlocks')
const builders = need('BuilderTransformers')
const constId = new Map()
for (const m of allBlocks.matchAll(/public static final \w+(?:<[^;=]*?>)?\s+(\w+)\s*=\s*REGISTRATE\s*\.\s*block(?:<[^>]*>)?\(\s*"([a-z0-9_]+)"/g)) {
  constId.set(m[1], m[2])
}

/** setImpact・setCapacity・setNoImpact を読む */
function stressIn(body) {
  const e = {}
  const impact = body.match(/setImpact\(\s*([0-9.]+)/)
  const capacity = body.match(/setCapacity\(\s*([0-9.]+)/)
  if (impact) e.impact = Number(impact[1])
  if (capacity) e.capacity = Number(capacity[1])
  if (body.includes('setNoImpact')) e.impact = 0
  return e
}

/** BuilderTransformers の方法の中身 */
function builderBody(method) {
  const start = builders.search(new RegExp(`\\s${method}\\s*\\(`))
  if (start < 0) return ''
  const next = builders.indexOf('public static', start + 1)
  return builders.slice(start, next < 0 ? undefined : next)
}

const stress = new Map()
for (const m of allBlocks.matchAll(/\.block(?:<[^>]*>)?\(\s*"([a-z0-9_]+)"([\s\S]*?)\.register\(\)/g)) {
  let body = m[2]
  for (const b of body.matchAll(/BuilderTransformers\.(\w+)\(/g)) body += builderBody(b[1])
  const e = stressIn(body)
  if (Object.keys(e).length > 0) stress.set(`create:${m[1]}`, e)
}
// 色違いの取っ手は、名前を組み立てる方法の中で登録する
const valve = allBlocks.match(/colourName \+ "_valve_handle"([\s\S]*?)\.register\(\)/)
if (valve) {
  const e = stressIn(valve[1])
  if (Object.keys(e).length > 0) {
    for (const id of allIds) if (id.endsWith('_valve_handle') && !stress.has(id)) stress.set(id, e)
  }
}

// ---- ブロックエンティティ ----
const parent = new Map()
for (const [name, src] of java) {
  const m = src.match(new RegExp(`\\bclass\\s+${name}\\b(?:<[^{]*?>)?\\s+extends\\s+(\\w+)`))
  if (m) parent.set(name, m[1])
}
function isKinetic(cls) {
  const seen = new Set()
  while (cls && !seen.has(cls)) {
    if (cls === 'KineticBlockEntity') return true
    seen.add(cls)
    cls = parent.get(cls)
  }
  return false
}

// 色違いなどの一覧の定数 → ID の終わり
const LIST_SUFFIX = {
  DYED_VALVE_HANDLES: '_valve_handle',
  NIXIE_TUBES: 'nixie_tube',
  PACKAGE_POSTBOXES: '_postbox',
  TABLE_CLOTHS: '_table_cloth',
  TOOLBOXES: '_toolbox',
}
const blockEntities = new Map()
const unresolved = []
for (const m of need('AllBlockEntityTypes').matchAll(/public static final BlockEntityEntry<(\w+)(?:<[^>]*>)?>\s+(\w+)\s*=\s*REGISTRATE([\s\S]*?)\.register\(\)/g)) {
  const [, cls, constName, body] = m
  const type = body.match(/\.blockEntity\(\s*"([a-z0-9_]+)"/)?.[1] ?? constName.toLowerCase()
  const valid = [...body.matchAll(/\.validBlocks?\(([\s\S]*?)\)\s*(?=\.|$)/g)].map((v) => v[1]).join(' ')
  for (const [, ref] of valid.matchAll(/AllBlocks\.(\w+)/g)) {
    let ids
    if (constId.has(ref)) ids = [`create:${constId.get(ref)}`]
    else if (LIST_SUFFIX[ref]) ids = allIds.filter((id) => id.endsWith(LIST_SUFFIX[ref]) && id !== 'create:copper_valve_handle')
    else {
      unresolved.push(ref)
      continue
    }
    for (const id of ids) {
      const entry = { type, class: cls, kinetic: isKinetic(cls) }
      const list = blockEntities.get(id) ?? []
      if (!list.some((e) => e.type === entry.type)) list.push(entry)
      blockEntities.set(id, list)
    }
  }
}
if (unresolved.length > 0) throw new Error(`ID が分からない定数があります：${[...new Set(unresolved)].join(', ')}`)
const unknown = [...blockEntities.keys(), ...stress.keys()].filter((id) => !list.blocks[id])
if (unknown.length > 0) throw new Error(`ブロックの一覧にない ID があります：${unknown.join(', ')}`)

for (const [id, block] of Object.entries(list.blocks)) {
  delete block.blockEntity
  delete block.stress
  if (blockEntities.has(id)) block.blockEntity = blockEntities.get(id)
  if (stress.has(id)) block.stress = stress.get(id)
}
list.createSource = `${sourceLabel}（AllBlocks.java・BuilderTransformers.java・AllBlockEntityTypes.java。kinetic は KineticBlockEntity を継ぐクラス）`
delete list.blockEntitySource
writeFileSync(listPath, JSON.stringify(list, null, 2) + '\n')
console.log(`ブロックエンティティ ${blockEntities.size} 個、応力の初期値 ${stress.size} 個を ${listPath} に書き足した`)
