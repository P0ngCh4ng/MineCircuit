// ブロック状態の定義（assets/<namespace>/blockstates/<path>.json）から、properties が取りうる値を読む（#27）。
// 回転（rotation.ts）と置くブロック（BlockBrush）が、その範囲の値だけを使うようにする。
// Modpack がない・定義がない・形が分からないときは null を返し、回転の規則のとおりに回す。

import type { ResourceLocation } from '../domain/resourceLocation'
import type { JsonValue } from '../io/modpack/jarScanner'
import type { PropertyValueOptions } from './rotation'

/** ブロック状態の定義を返すもの。Modpack がこの形を満たす */
export interface BlockStateDefinitionSource {
  blockStateDefinition(id: ResourceLocation): JsonValue | null
}

type JsonObject = { [key: string]: JsonValue }

function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** property ごとに値を集める。順番は最初に出てきた順 */
class OptionCollector {
  private readonly values = new Map<string, string[]>()
  /** 一覧が足りないかもしれない property（multipart の否定の条件に出てきたもの） */
  private readonly open = new Set<string>()

  add(name: string, value: string): void {
    if (name === '' || value === '') return
    let list = this.values.get(name)
    if (!list) {
      list = []
      this.values.set(name, list)
    }
    if (!list.includes(value)) list.push(value)
  }

  markOpen(name: string): void {
    this.open.add(name)
  }

  result(): PropertyValueOptions | null {
    const out: Record<string, readonly string[]> = {}
    for (const [name, list] of this.values) {
      if (!this.open.has(name)) out[name] = list
    }
    return Object.keys(out).length > 0 ? out : null
  }
}

// variants のキー（"axis=x,powered=false"）。"" や "normal" のように = のない部分は読まない
function collectVariantKey(key: string, out: OptionCollector): void {
  for (const part of key.split(',')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    out.add(part.slice(0, eq).trim(), part.slice(eq + 1).trim())
  }
}

// 条件の値。"north|south" は複数の値。true / 1 のように文字列でない値も文字列にする
function conditionValues(v: JsonValue): string[] | null {
  if (typeof v === 'string') return v.split('|').map((s) => s.trim())
  if (typeof v === 'boolean' || typeof v === 'number') return [String(v)]
  return null
}

// multipart の when。{ "facing": "north|south" }、{ "OR": [...] }、{ "AND": [...] }
function collectCondition(when: JsonValue | undefined, out: OptionCollector): void {
  if (Array.isArray(when)) {
    for (const c of when) collectCondition(c, out)
    return
  }
  if (!isObject(when)) return
  for (const [name, value] of Object.entries(when)) {
    if (name === 'OR' || name === 'AND') {
      collectCondition(value, out)
      continue
    }
    const values = conditionValues(value)
    if (!values) continue
    for (const raw of values) {
      if (raw.startsWith('!')) {
        // 「この値でない」は、ほかの値を教えてくれない。この property は制限しない
        out.markOpen(name)
        out.add(name, raw.slice(1))
      } else {
        out.add(name, raw)
      }
    }
  }
}

/**
 * ブロック状態の定義の JSON から、properties が取りうる値の一覧を作る。
 * - variants 形式：キー（"facing=north,powered=false"）に出てくる値を集める
 * - multipart 形式：when の条件（OR / AND の中も含む）に出てくる値を集める
 * 定義に出てこない property は一覧に入れない（値を制限しない）。
 * multipart で否定の条件（"!north"）があった property も、一覧が足りないかもしれないので入れない。
 * 何も読めなければ null。
 */
export function parsePropertyValueOptions(definition: JsonValue | null): PropertyValueOptions | null {
  if (!isObject(definition)) return null
  const out = new OptionCollector()
  const variants = definition.variants
  if (isObject(variants)) {
    for (const key of Object.keys(variants)) collectVariantKey(key, out)
  }
  const multipart = definition.multipart
  if (Array.isArray(multipart)) {
    for (const part of multipart) {
      if (isObject(part)) collectCondition(part.when, out)
    }
  }
  return out.result()
}

const cache = new WeakMap<BlockStateDefinitionSource, Map<string, PropertyValueOptions | null>>()

/**
 * id のブロックが取りうる値の一覧。source（Modpack）が null か、定義がなければ null。
 * 同じ source と id の結果は覚えておく。
 */
export function propertyValueOptionsFor(
  source: BlockStateDefinitionSource | null,
  id: ResourceLocation,
): PropertyValueOptions | null {
  if (!source) return null
  let perSource = cache.get(source)
  if (!perSource) {
    perSource = new Map()
    cache.set(source, perSource)
  }
  const key = `${id.namespace}:${id.path}`
  if (perSource.has(key)) return perSource.get(key) ?? null
  const options = parsePropertyValueOptions(source.blockStateDefinition(id))
  perSource.set(key, options)
  return options
}

/**
 * ブロックを一覧から選んだときに使う、はじめの properties（#71）。
 * - variants 形式：最初のキー（"facing=north,powered=false"）の値。ゲームの初期値とは限らないが、定義にある組み合わせになる
 * - multipart 形式など：取りうる値の一覧の、それぞれ最初の値
 * source が null か、定義がなければ空（properties なし）。
 */
export function initialPropertiesFor(
  source: BlockStateDefinitionSource | null,
  id: ResourceLocation,
): Record<string, string> {
  const out: Record<string, string> = {}
  if (!source) return out
  const definition = source.blockStateDefinition(id)
  if (isObject(definition) && isObject(definition.variants)) {
    const first = Object.keys(definition.variants).find((key) => key.includes('='))
    if (first !== undefined) {
      for (const part of first.split(',')) {
        const eq = part.indexOf('=')
        const name = eq < 0 ? '' : part.slice(0, eq).trim()
        const value = eq < 0 ? '' : part.slice(eq + 1).trim()
        if (name !== '' && value !== '') out[name] = value
      }
      return out
    }
  }
  const options = propertyValueOptionsFor(source, id)
  for (const [name, values] of Object.entries(options ?? {})) {
    if (values.length > 0) out[name] = values[0]
  }
  return out
}
