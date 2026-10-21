// Modpack の中身（docs/design.md「Modpack / ModpackLoader」）。
// mods/ の jar を読んだ結果をまとめ、Mod の一覧、namespace の有無、表示名、ブロック状態の定義、設定ファイルを返す。
// Modpack がないときは、使う側が `Modpack | null` の null を扱う。

import type { ResourceLocation } from '../../domain/resourceLocation'
import { FileNotFoundError, normalizePath, type FileSource } from '../fileSource'
import { LANG_CODES, type JarSummary, type JsonValue, type LangCode, type LangTable } from './jarScanner'
import type { LangPack } from './langPacks'
import type { ModInfo } from './modMetadata'

/** jar の中にないが、いつもある namespace（Minecraft 本体） */
export const BUILTIN_NAMESPACES: readonly string[] = ['minecraft']

/** 読めなかった jar やファイル */
export interface ModpackProblem {
  /** jar のファイル名、またはリソースパックのパス（`resourcepacks/foo.zip`） */
  readonly jar: string
  readonly message: string
}

/** 表示名を探す翻訳キーの種類（前にあるものを優先） */
const NAME_KINDS = ['block', 'item', 'entity', 'fluid'] as const

export class Modpack {
  /** Mod の一覧（jar の名前順） */
  readonly mods: readonly ModInfo[]
  /** jar の `assets/<namespace>/` にある namespace（名前順）。Minecraft 本体は含まない */
  readonly namespaces: readonly string[]
  /** 読めなかった jar やファイル */
  readonly problems: readonly ModpackProblem[]
  /** 読んだ jar の数 */
  readonly jarCount: number
  /** 翻訳を読んだ jar の外の置き場所（`resourcepacks/foo.zip`、`ModTranslations`）。優先度の低い順 */
  readonly langPacks: readonly string[]

  private readonly namespaceSet: ReadonlySet<string>
  private readonly lang: Record<LangCode, LangTable>
  private readonly blockStates: ReadonlyMap<string, JsonValue>
  private readonly source: FileSource | null

  /**
   * jar ごとの結果からまとめる。summaries は jar の名前順に渡す。
   * 同じキーの表示名やブロック状態の定義が複数の jar にあれば、後の jar のものを使う。
   * source は設定ファイルを読むための Modpack のフォルダ。null なら config() は常に null。
   * langPacks は jar の外の翻訳（リソースパックなど）で、優先度の低い順に渡す。jar の翻訳より優先し、後ろのものほど優先する。
   */
  constructor(
    summaries: readonly JarSummary[],
    source: FileSource | null,
    problems: readonly ModpackProblem[] = [],
    langPacks: readonly LangPack[] = [],
  ) {
    const mods: ModInfo[] = []
    const namespaces = new Set<string>()
    const lang: Record<LangCode, LangTable> = { ja_jp: {}, en_us: {} }
    const blockStates = new Map<string, JsonValue>()
    const allProblems: ModpackProblem[] = [...problems]
    for (const s of summaries) {
      mods.push(...s.mods)
      for (const ns of s.namespaces) namespaces.add(ns)
      for (const code of LANG_CODES) Object.assign(lang[code], s.lang[code])
      for (const [id, def] of Object.entries(s.blockStates)) blockStates.set(id, def)
      for (const message of s.problems) allProblems.push({ jar: s.jar, message })
    }
    for (const p of langPacks) {
      for (const code of LANG_CODES) Object.assign(lang[code], p.lang[code])
      for (const message of p.problems) allProblems.push({ jar: p.path, message })
    }
    this.langPacks = langPacks.map((p) => p.path)
    this.mods = mods
    this.namespaces = [...namespaces].sort()
    this.namespaceSet = namespaces
    this.lang = lang
    this.blockStates = blockStates
    this.problems = allProblems
    this.jarCount = summaries.length
    this.source = source
  }

  /** namespace の Mod が入っているか。jar の `assets/<namespace>/` で判定する。`minecraft` は常に true */
  hasNamespace(ns: string): boolean {
    return BUILTIN_NAMESPACES.includes(ns) || this.namespaceSet.has(ns)
  }

  /**
   * 表示名。`block.<ns>.<path>`、`item.<ns>.<path>` の順に探す。その言語の翻訳がなければ null。
   * リソースパック・ModTranslations の翻訳があれば jar の翻訳より優先する。
   * Minecraft 本体の翻訳は mods/ にないので、リソースパックが足していなければ `minecraft:` のブロックは null になる。
   */
  displayName(id: ResourceLocation, lang: LangCode): string | null {
    const table = this.lang[lang]
    for (const kind of NAME_KINDS) {
      const name = table[`${kind}.${id.namespace}.${id.path}`]
      if (name !== undefined) return name
    }
    return null
  }

  /** 表示名の数（言語ごと） */
  displayNameCount(lang: LangCode): number {
    return Object.keys(this.lang[lang]).length
  }

  /**
   * ブロック状態の定義（`assets/<ns>/blockstates/<path>.json` の JSON）。なければ null。
   * 取りうるプロパティの値を読むのは使う側（#27）。
   */
  blockStateDefinition(id: ResourceLocation): JsonValue | null {
    return this.blockStates.get(`${id.namespace}:${id.path}`) ?? null
  }

  /**
   * ブロック状態の定義があるブロックの ID（`namespace:path`、名前順）。置けるブロックの一覧に使う（#71）。
   * Minecraft 本体のブロックは mods/ にないので含まない。
   */
  blockIds(): string[] {
    return [...this.blockStates.keys()].sort()
  }

  /**
   * 設定ファイルの中身（UTF-8 の文字列）。path は Modpack のフォルダからの相対パス
   * （`config/create-common.toml`、`defaultconfigs/create-server.toml` など）。なければ null。
   */
  async config(path: string): Promise<string | null> {
    if (!this.source) return null
    try {
      const bytes = await this.source.read(normalizePath(path))
      const text = new TextDecoder('utf-8').decode(bytes)
      return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
    } catch (e) {
      if (e instanceof FileNotFoundError) return null
      throw e
    }
  }

  /**
   * Modpack のフォルダの中の項目の名前（名前順。フォルダは末尾に `/`）。dir は Modpack のフォルダからの相対パス
   * （`saves/` など）。フォルダがない、または source がなければ空の配列。
   * 計算プラグインがワールドごとの設定（saves/<ワールド>/serverconfig/）を探すのに使う（CalcModpack.list）。
   */
  async list(dir: string): Promise<string[]> {
    if (!this.source) return []
    try {
      return [...(await this.source.list(normalizePath(dir)))].sort()
    } catch (e) {
      if (e instanceof FileNotFoundError) return []
      throw e
    }
  }
}
