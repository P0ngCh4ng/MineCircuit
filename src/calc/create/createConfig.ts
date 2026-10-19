// Create のサーバー設定（create-server.toml）を読む（docs/create-stress.md「設定ファイルの場所」「TOML の形」）。
// 使う項目は数と真偽だけなので、TOML の全部ではなく、表の見出し・key = value・コメントだけを読む。

import type { CalcModpack } from '../calcPlugin'

/** 設定ファイルの値。使うのは数と真偽だけ。文字列も読んでおく */
export type TomlValue = number | boolean | string

/**
 * TOML の一部を読み、`kinetics.stats.mediumSpeed` のような点区切りのキーの一覧にする。
 * 配列やインラインの表など、読めない値は飛ばす。
 */
export function parseTomlSubset(text: string): Map<string, TomlValue> {
  const result = new Map<string, TomlValue>()
  let table: string[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim()
    if (line === '') continue
    if (line.startsWith('[')) {
      // [[配列の表]] は使わないので、中身ごと読み飛ばす
      if (line.startsWith('[[')) {
        table = ['\u0000']
        continue
      }
      const close = line.lastIndexOf(']')
      if (close < 0) continue
      table = splitKey(line.slice(1, close))
      continue
    }
    const eq = findUnquoted(line, '=')
    if (eq < 0 || table[0] === '\u0000') continue
    const key = splitKey(line.slice(0, eq))
    const value = parseValue(line.slice(eq + 1).trim())
    if (key.length === 0 || value === null) continue
    result.set([...table, ...key].join('.'), value)
  }
  return result
}

function stripComment(line: string): string {
  const i = findUnquoted(line, '#')
  return i < 0 ? line : line.slice(0, i)
}

/** 引用符の外にある ch の位置 */
function findUnquoted(line: string, ch: string): number {
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === '\\' && quote === '"') i++
      else if (c === quote) quote = null
    } else if (c === '"' || c === "'") quote = c
    else if (c === ch) return i
  }
  return -1
}

/** `a.b."c.d"` を ['a', 'b', 'c.d'] にする */
function splitKey(key: string): string[] {
  const parts: string[] = []
  let rest = key.trim()
  while (rest !== '') {
    if (rest[0] === '"' || rest[0] === "'") {
      const end = rest.indexOf(rest[0], 1)
      if (end < 0) return []
      parts.push(rest.slice(1, end))
      rest = rest.slice(end + 1).trim()
    } else {
      const dot = rest.indexOf('.')
      parts.push((dot < 0 ? rest : rest.slice(0, dot)).trim())
      rest = dot < 0 ? '' : rest.slice(dot)
    }
    if (rest.startsWith('.')) rest = rest.slice(1).trim()
  }
  return parts.filter((p) => p !== '')
}

function parseValue(s: string): TomlValue | null {
  if (s === 'true') return true
  if (s === 'false') return false
  if (s.startsWith('"') || s.startsWith("'")) {
    const end = s.lastIndexOf(s[0])
    return end > 0 ? s.slice(1, end) : null
  }
  const n = Number(s.replace(/_/g, ''))
  return s !== '' && Number.isFinite(n) ? n : null
}

/** create-server.toml から取り出した、応力の計算に使う値 */
export interface CreateServerConfig {
  /** どのファイルから読んだか（Modpack のフォルダからの相対パス） */
  readonly path: string
  readonly maxRotationSpeed: number | null
  readonly disableStress: boolean | null
  readonly mediumSpeed: number | null
  readonly fastSpeed: number | null
  /** stressValues の版（v2 なら 2）。表がなければ null */
  readonly stressVersion: number | null
  /** ブロック名（`create:` なし）→ SU/RPM */
  readonly impact: ReadonlyMap<string, number>
  readonly capacity: ReadonlyMap<string, number>
}

/** 設定ファイルの文字列から値を取り出す */
export function readCreateServerConfig(text: string, path: string): CreateServerConfig {
  const toml = parseTomlSubset(text)
  const num = (key: string): number | null => {
    const v = toml.get(key)
    return typeof v === 'number' ? v : null
  }
  const bool = (key: string): boolean | null => {
    const v = toml.get(key)
    return typeof v === 'boolean' ? v : null
  }
  // kinetics.stressValues.v<番号>.impact|capacity.<ブロック名>。番号が一番大きいものを使う
  const pattern = /^kinetics\.stressValues\.v(\d+)\.(impact|capacity)\.(.+)$/
  let version: number | null = null
  for (const key of toml.keys()) {
    const m = pattern.exec(key)
    if (m) version = Math.max(version ?? 0, Number(m[1]))
  }
  const impact = new Map<string, number>()
  const capacity = new Map<string, number>()
  if (version !== null) {
    for (const [key, value] of toml) {
      const m = pattern.exec(key)
      if (!m || Number(m[1]) !== version || typeof value !== 'number') continue
      ;(m[2] === 'impact' ? impact : capacity).set(m[3], value)
    }
  }
  return {
    path,
    maxRotationSpeed: num('kinetics.maxRotationSpeed'),
    disableStress: bool('kinetics.disableStress'),
    mediumSpeed: num('kinetics.stats.mediumSpeed'),
    fastSpeed: num('kinetics.stats.fastSpeed'),
    stressVersion: version,
    impact,
    capacity,
  }
}

export const CREATE_SERVER_CONFIG = 'create-server.toml'

/** 設定ファイルを探した結果 */
export interface CreateConfigLookup {
  /** 見つからなければ null（内蔵の初期値を使う） */
  readonly config: CreateServerConfig | null
  /** 見つかったファイルのすべて。2つ以上なら、先頭を使ったことを仮定に載せる */
  readonly candidates: readonly string[]
}

/**
 * Modpack から create-server.toml を探す。
 * 1. defaultconfigs/create-server.toml
 * 2. saves/<ワールド>/serverconfig/create-server.toml（複数あれば名前順で先頭）
 * Modpack がない、またはファイルがなければ config は null。
 */
export async function loadCreateConfig(pack: CalcModpack | null): Promise<CreateConfigLookup> {
  if (!pack) return { config: null, candidates: [] }
  const defaults = `defaultconfigs/${CREATE_SERVER_CONFIG}`
  const text = await pack.config(defaults)
  if (text !== null) return { config: readCreateServerConfig(text, defaults), candidates: [defaults] }

  const found: { path: string; text: string }[] = []
  for (const world of await listDirs(pack, 'saves/')) {
    const path = `saves/${world}serverconfig/${CREATE_SERVER_CONFIG}`
    const t = await pack.config(path)
    if (t !== null) found.push({ path, text: t })
  }
  if (found.length === 0) return { config: null, candidates: [] }
  return { config: readCreateServerConfig(found[0].text, found[0].path), candidates: found.map((f) => f.path) }
}

async function listDirs(pack: CalcModpack, dir: string): Promise<string[]> {
  if (!pack.list) return []
  let entries: string[]
  try {
    entries = await pack.list(dir)
  } catch {
    // saves/ がない Modpack（サーバー用など）もある
    return []
  }
  return entries.filter((e) => e.endsWith('/')).sort()
}
