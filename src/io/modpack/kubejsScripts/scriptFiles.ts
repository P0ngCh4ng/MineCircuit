// kubejs/server_scripts/ のスクリプトを読み、KubeJS と同じ順に並べる（docs/create-throughput.md「KubeJS のスクリプトのレシピ」）。
// 順は KubeJS のソースで確かめた（1802 と 2101 の ScriptFile.compareTo・ScriptFileInfo）。
// 先頭のコメント `// priority: n` の大きいものから、同じならパスを大文字小文字を区別せずに名前順。

import { FileNotFoundError, isDirectoryEntry, type FileSource } from '../../fileSource'
import type { KubeJsScriptFile } from './scriptTypes'

/** KubeJS がたどるフォルダの深さ（Files.walk(dir, 10)） */
const MAX_DEPTH = 10

/** ファイルの先頭のコメントに書く設定 */
export interface ScriptHeader {
  readonly priority: number
  /** `// ignored: true`（`ignore` も）。動かさない */
  readonly ignored: boolean
  /** `// requires: <modId>`（1.21 の KubeJS）。どれかが Modpack になければ動かさない */
  readonly requires: readonly string[]
}

/**
 * 先頭の `//` の行から `名前: 値` を読む。`//` で始まらない行（空行を除く）で終わる。
 * 1.18 の KubeJS は空行でも終わるが、空行のあとに設定を書くファイルはまずないので区別しない
 */
export function readScriptHeader(text: string): ScriptHeader {
  let priority = 0
  let ignored = false
  const requires: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    if (!line.startsWith('//')) break
    const m = /^([^:]+):(.*)$/.exec(line.slice(2))
    if (!m) continue
    const key = m[1].trim().toLowerCase()
    const value = m[2].trim()
    if (key === 'priority') {
      const n = Number.parseInt(value, 10)
      if (Number.isFinite(n)) priority = n
    } else if ((key === 'ignored' || key === 'ignore') && value === 'true') {
      ignored = true
    } else if (key === 'requires' && value !== '') {
      requires.push(value)
    }
  }
  return { priority, ignored, requires }
}

/** 動かさなかったファイル */
export interface SkippedScript {
  readonly path: string
  readonly reason: string
}

/** 動かす順に並べる。ignored と、必要な Mod がないファイルは除く */
export function orderScripts(
  files: readonly KubeJsScriptFile[],
  modIds: ReadonlySet<string>,
): { files: KubeJsScriptFile[]; skipped: SkippedScript[] } {
  const skipped: SkippedScript[] = []
  const kept: { file: KubeJsScriptFile; priority: number; key: string }[] = []
  for (const file of files) {
    const header = readScriptHeader(file.text)
    if (header.ignored) {
      skipped.push({ path: file.path, reason: 'ignored' })
      continue
    }
    const missing = header.requires.filter((id) => !modIds.has(id))
    if (missing.length > 0) {
      skipped.push({ path: file.path, reason: `requires: ${missing.join(', ')}` })
      continue
    }
    kept.push({ file, priority: header.priority, key: file.path.toLowerCase() })
  }
  kept.sort((a, b) => b.priority - a.priority || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return { files: kept.map((k) => k.file), skipped }
}

/** kubejs/server_scripts/ の下の `.js` を読む。フォルダがなければ空 */
export async function readServerScripts(
  source: FileSource,
  dir: string,
): Promise<{ files: KubeJsScriptFile[]; problems: string[] }> {
  const files: KubeJsScriptFile[] = []
  const problems: string[] = []
  const decoder = new TextDecoder('utf-8')
  const visit = async (path: string, depth: number): Promise<void> => {
    let names: string[]
    try {
      names = await source.list(path)
    } catch (e) {
      if (e instanceof FileNotFoundError) return
      throw e
    }
    for (const name of names) {
      const child = `${path}/${isDirectoryEntry(name) ? name.slice(0, -1) : name}`
      if (isDirectoryEntry(name)) {
        if (depth < MAX_DEPTH) await visit(child, depth + 1)
        continue
      }
      if (!name.toLowerCase().endsWith('.js')) continue
      try {
        files.push({ path: child.slice(dir.length + 1), text: decoder.decode(await source.read(child)) })
      } catch (e) {
        problems.push(`${child}: 読めません（${e instanceof Error ? e.message : String(e)}）`)
      }
    }
  }
  await visit(dir, 1)
  return { files, problems }
}
