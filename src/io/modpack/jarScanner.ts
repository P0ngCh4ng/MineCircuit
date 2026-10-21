// Mod の jar（zip）1つを開き、必要なファイルだけを取り出してまとめる。
// 取り出すのは Mod の情報、翻訳ファイル（ja_jp / en_us）、ブロック状態の定義だけ。Java のコードは読まない。
// 時間がかかるので、画面では Web Worker の中で呼ぶ（workers/jarScan.worker.ts）。

import { inflateSync, unzipSync, type UnzipFileInfo } from 'fflate'
import {
  FABRIC_MOD_JSON,
  FORGE_MODS_TOML,
  MANIFEST,
  NEOFORGE_MODS_TOML,
  modsFromFabricJson,
  modsFromToml,
  stripBom,
  type ModInfo,
} from './modMetadata'
import type { ExtractedZip } from './partialZip'

/** JSON の値 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** 読む翻訳ファイルの言語 */
export type LangCode = 'ja_jp' | 'en_us'
export const LANG_CODES: readonly LangCode[] = ['ja_jp', 'en_us']

/** 翻訳のキー（`block.create.shaft`）→ 表示名 */
export type LangTable = Record<string, string>

/** jar 1つ分を読んだ結果。IndexedDB に保存し、Worker からも送るので、ただのデータだけにする */
export interface JarSummary {
  /** jar のファイル名 */
  readonly jar: string
  readonly mods: ModInfo[]
  /** `assets/<namespace>/` のフォルダ名（名前順） */
  readonly namespaces: string[]
  /** 言語ごとの表示名。ブロック・アイテム・エンティティ・液体の名前だけを残す */
  readonly lang: Record<LangCode, LangTable>
  /**
   * ブロック状態の定義（`assets/<namespace>/blockstates/<path>.json`）。キーは `namespace:path`。
   * JSON をそのまま持つ。向きの候補を読むのは #27 の仕事
   */
  readonly blockStates: Record<string, JsonValue>
  /** 読めなかったファイル（壊れた JSON など）。読み込みは続ける */
  readonly problems: string[]
}

/** jar の中の jar（Forge の JarJar、Fabric の jars）を読む深さ */
const MAX_NESTED_DEPTH = 2

const LANG_PATH = /^assets\/([^/]+)\/lang\/(ja_jp|en_us)\.json$/i
const BLOCKSTATE_PATH = /^assets\/([^/]+)\/blockstates\/(.+)\.json$/
const NESTED_JAR_PATH = /^META-INF\/(jarjar|jars)\/[^/]+\.jar$/
const ASSETS_NAMESPACE = /^assets\/([^/]+)\//
/** 残す翻訳のキー。`種類.namespace.path` の3つに分かれるものだけ（説明文などは捨てる） */
const NAME_KEY = /^(block|item|entity|fluid)\.[^.]+\.[^.]+$/

const METADATA_FILES = new Set([FORGE_MODS_TOML, NEOFORGE_MODS_TOML, FABRIC_MOD_JSON, MANIFEST])

/** jar の中で読むファイルか（Mod の情報、翻訳、ブロック状態の定義、jar の中の jar） */
export function isWantedJarEntry(name: string): boolean {
  return METADATA_FILES.has(name) || LANG_PATH.test(name) || BLOCKSTATE_PATH.test(name) || NESTED_JAR_PATH.test(name)
}

const decoder = new TextDecoder('utf-8')

function text(bytes: Uint8Array): string {
  return stripBom(decoder.decode(bytes))
}

/**
 * JSON を読む。Minecraft（Gson）が受け付ける少し崩れた JSON も読めるよう、
 * 失敗したら文字列の中の改行などの制御文字と、閉じかっこの前の余分な `,` を直してもう一度読む。
 */
export function parseLenientJson(source: string): unknown {
  try {
    return JSON.parse(source)
  } catch (first) {
    let out = ''
    let inString = false
    for (let i = 0; i < source.length; i++) {
      const c = source[i]
      if (inString) {
        if (c === '\\') {
          out += c + (source[++i] ?? '')
        } else if (c === '"') {
          inString = false
          out += c
        } else if (c.charCodeAt(0) < 0x20) {
          out += `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
        } else {
          out += c
        }
      } else if (c === '"') {
        inString = true
        out += c
      } else if (c === ',' && /^\s*[}\]]/.test(source.slice(i + 1, i + 64))) {
        // 閉じかっこの前の余分な `,` は捨てる
      } else {
        out += c
      }
    }
    try {
      return JSON.parse(out)
    } catch {
      throw first
    }
  }
}

function emptySummary(jar: string): JarSummary {
  return { jar, mods: [], namespaces: [], lang: { ja_jp: {}, en_us: {} }, blockStates: {}, problems: [] }
}

/** 翻訳ファイルの JSON から、名前のキーだけを取り出す */
export function pickNames(data: unknown): LangTable | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const out: LangTable = {}
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' && NAME_KEY.test(key)) out[key] = value
  }
  return out
}

/**
 * jar を読む。zip として壊れていればエラーを投げる。
 * 中の個々のファイルが読めないときは problems に書いて続ける。
 */
export function scanJar(jar: string, bytes: Uint8Array): JarSummary {
  return scan(jar, bytes, 0)
}

function scan(jar: string, bytes: Uint8Array, depth: number): JarSummary {
  const namespaces = new Set<string>()
  const files = unzipSync(bytes, {
    filter(file: UnzipFileInfo) {
      const ns = ASSETS_NAMESPACE.exec(file.name)
      if (ns) namespaces.add(ns[1])
      return isWantedJarEntry(file.name)
    },
  })
  return summarize(jar, files, namespaces, depth)
}

/**
 * jar の中身。ファイル全体（zip）か、必要な部分だけを読んで取り出したもの（partialZip.ts）。
 * どちらも structured clone で Worker に送れる
 */
export type JarContent =
  | { readonly kind: 'zip'; readonly bytes: Uint8Array }
  | { readonly kind: 'entries'; readonly zip: ExtractedZip }

/**
 * readZipPartially で取り出した項目を展開する。結果は unzipSync に filter を付けたときと同じ。
 * 圧縮の方式が分からない項目があればエラーを投げる（unzipSync と同じ）
 */
export function inflateExtractedZip(zip: ExtractedZip): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  for (const entry of zip.entries) {
    if (entry.compression === 0) files[entry.name] = entry.data.slice()
    else if (entry.compression === 8) {
      files[entry.name] = inflateSync(entry.data, { out: new Uint8Array(entry.originalSize) })
    } else throw new Error(`unknown compression type ${entry.compression}`)
  }
  return files
}

/** jar を読む。中身がファイル全体でも、取り出した項目でも、結果は同じ */
export function scanJarContent(jar: string, content: JarContent): JarSummary {
  if (content.kind === 'zip') return scanJar(jar, content.bytes)
  const namespaces = new Set<string>()
  for (const name of content.zip.names) {
    const ns = ASSETS_NAMESPACE.exec(name)
    if (ns) namespaces.add(ns[1])
  }
  return summarize(jar, inflateExtractedZip(content.zip), namespaces, 0)
}

function summarize(jar: string, files: Record<string, Uint8Array>, namespaces: Set<string>, depth: number): JarSummary {
  const summary = emptySummary(jar)
  const problems = summary.problems
  const read = (name: string): string | null => (files[name] ? text(files[name]) : null)

  // Mod の情報
  const manifest = read(MANIFEST)
  const toml = read(NEOFORGE_MODS_TOML) ?? read(FORGE_MODS_TOML)
  const fabric = read(FABRIC_MOD_JSON)
  if (toml !== null) summary.mods.push(...modsFromToml(toml, jar, manifest))
  else if (fabric !== null) summary.mods.push(...modsFromFabricJson(fabric, jar))

  for (const name of Object.keys(files).sort()) {
    const data = files[name]
    const lang = LANG_PATH.exec(name)
    if (lang) {
      const code = lang[2].toLowerCase() as LangCode
      try {
        const names = pickNames(parseLenientJson(text(data)))
        if (names) Object.assign(summary.lang[code], names)
        else problems.push(`${name}: 翻訳ファイルの形が違います`)
      } catch {
        problems.push(`${name}: JSON として読めません`)
      }
      continue
    }
    const blockState = BLOCKSTATE_PATH.exec(name)
    if (blockState) {
      try {
        summary.blockStates[`${blockState[1]}:${blockState[2]}`] = parseLenientJson(text(data)) as JsonValue
      } catch {
        problems.push(`${name}: JSON として読めません`)
      }
      continue
    }
    if (NESTED_JAR_PATH.test(name) && depth < MAX_NESTED_DEPTH) {
      const nestedName = `${jar}!/${name}`
      try {
        mergeInto(summary, scan(nestedName, data, depth + 1), namespaces)
      } catch (e) {
        problems.push(`${name}: jar として読めません（${e instanceof Error ? e.message : String(e)}）`)
      }
    }
  }

  summary.namespaces.push(...[...namespaces].sort())
  return summary
}

/** jar の中の jar の結果を、外の jar の結果に足す。外の jar にあるものを優先する */
function mergeInto(target: JarSummary, nested: JarSummary, namespaces: Set<string>): void {
  target.mods.push(...nested.mods)
  for (const ns of nested.namespaces) namespaces.add(ns)
  for (const code of LANG_CODES) {
    target.lang[code] = { ...nested.lang[code], ...target.lang[code] }
  }
  for (const [id, def] of Object.entries(nested.blockStates)) {
    if (!(id in target.blockStates)) target.blockStates[id] = def
  }
  target.problems.push(...nested.problems.map((p) => `${nested.jar}: ${p}`))
}
