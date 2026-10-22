// ブロック状態の定義（assets/<ns>/blockstates/<path>.json）から、ブロック状態に合うモデルを選ぶ（#82）。
// variants 形式と multipart 形式の両方を扱う。モデルの中身は読まない（modelResolver が読む）。
// edit/orientationOptions.ts も同じ JSON を読むが、あちらは「取りうる値を集める」、こちらは「合うものを選ぶ」で
// することが違うので、共有はしない（io から edit は import できない）。

import type { QuarterTurn } from '../../domain/blockModel'
import type { JsonValue } from '../modpack/jarScanner'
import { isJsonObject, quarterTurn, withNamespace } from './modelJson'

/** blockstates で選ばれた1つのモデルと、その置き方（モデルはまだ読んでいない） */
export interface ModelReference {
  /** namespace 付きのモデルの ID */
  readonly model: string
  readonly x: QuarterTurn
  readonly y: QuarterTurn
  readonly uvlock: boolean
}

export type Properties = Readonly<Record<string, string>>

/** 選んだ結果。refs が null なら合うものがない（または形が分からない） */
export interface Selection {
  readonly refs: readonly ModelReference[] | null
  readonly notes: readonly string[]
}

// variants のキー（"facing=north,powered=false"）が状態に合うか。
// "" や "normal" のように = のない部分は条件にしない。キーにない property は何でもよい
export function variantKeyMatches(key: string, properties: Properties): boolean {
  for (const part of key.split(',')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    if (name === '') continue
    if (properties[name] !== part.slice(eq + 1).trim()) return false
  }
  return true
}

// 条件の値。"north|south" は複数の値。true / 1 のように文字列でない値も文字列にする
function conditionValues(v: JsonValue): string[] | null {
  if (typeof v === 'string') return v.split('|').map((s) => s.trim())
  if (typeof v === 'boolean' || typeof v === 'number') return [String(v)]
  return null
}

/**
 * multipart の when が状態に合うか。
 * - { "facing": "north|south" } … どれかの値なら合う。"!north" は「north でない」
 * - 複数の property … すべて合えば合う
 * - { "OR": [...] } / { "AND": [...] } … 中の条件のどれか / すべて
 * when がない（undefined）なら常に合う。形が分からない条件は合わないとする
 */
export function conditionMatches(when: JsonValue | undefined, properties: Properties): boolean {
  if (when === undefined) return true
  if (Array.isArray(when)) return when.every((c) => conditionMatches(c, properties))
  if (!isJsonObject(when)) return false
  for (const [name, value] of Object.entries(when)) {
    if (name === 'OR' || name === 'AND') {
      if (!Array.isArray(value)) return false
      const ok = name === 'OR' ? value.some((c) => conditionMatches(c, properties)) : value.every((c) => conditionMatches(c, properties))
      if (!ok) return false
      continue
    }
    const values = conditionValues(value)
    if (!values) return false
    // ない property は値 "" とみなす（"!north" には合い、"north" には合わない）
    const actual = properties[name] ?? ''
    // Minecraft と同じく、"!" は先頭に1つだけ書いて全体を否定する（"!north|south" は north でも south でもない）
    const negate = values[0]?.startsWith('!') === true
    const list = negate ? [values[0]!.slice(1), ...values.slice(1)] : values
    if (list.includes(actual) === negate) return false
  }
  return true
}

// variants の値（オブジェクト、または重み付きの配列）を ModelReference にする。配列は先頭を使う
function parseApply(v: JsonValue | undefined, where: string, notes: string[]): ModelReference | null {
  const one = Array.isArray(v) ? v[0] : v
  if (!isJsonObject(one) || typeof one.model !== 'string' || one.model === '') {
    notes.push(`${where} にモデルが書いてありません`)
    return null
  }
  let x = quarterTurn(one.x)
  let y = quarterTurn(one.y)
  if (x === null || y === null) {
    notes.push(`${where} の x / y が 90 度単位ではありません。0 にします`)
    x ??= 0
    y ??= 0
  }
  return { model: withNamespace(one.model), x, y, uvlock: one.uvlock === true }
}

/**
 * ブロック状態の定義から、状態に合うモデルを選ぶ。
 * - variants：キーが合うものを選ぶ。複数合えば後に書いたもの（Minecraft と同じく、後のものが上書きする）
 * - multipart：when が合う部分をすべて重ねる。合う部分がなければ空
 * どちらもなければ refs は null
 */
export function selectModels(definition: JsonValue, properties: Properties): Selection {
  const notes: string[] = []
  if (!isJsonObject(definition)) return { refs: null, notes: ['blockstates の形が分かりません'] }

  if (isJsonObject(definition.variants)) {
    let matched: string | null = null
    for (const key of Object.keys(definition.variants)) {
      if (variantKeyMatches(key, properties)) matched = key
    }
    if (matched === null) return { refs: null, notes: ['blockstates の variants に、この状態に合うものがありません'] }
    const ref = parseApply(definition.variants[matched], `variants の "${matched}"`, notes)
    return { refs: ref ? [ref] : null, notes }
  }

  if (Array.isArray(definition.multipart)) {
    const refs: ModelReference[] = []
    definition.multipart.forEach((part, i) => {
      if (!isJsonObject(part)) {
        notes.push(`multipart の ${i + 1} 番目の形が分かりません`)
        return
      }
      if (!conditionMatches(part.when, properties)) return
      const ref = parseApply(part.apply, `multipart の ${i + 1} 番目`, notes)
      if (ref) refs.push(ref)
    })
    return { refs, notes }
  }

  return { refs: null, notes: ['blockstates に variants も multipart もありません'] }
}
