// 設定ファイル（TOML）の一部を読む（docs/design.md「アドオンの表」）。Mod によらない部品なので共通の calc に置く。
// 計算に使う項目は数と真偽だけなので、TOML の全部ではなく、表の見出し・key = value・コメントだけを読む。

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
