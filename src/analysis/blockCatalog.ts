// 置けるブロックの一覧と検索（#71）。Modpack の jar にあるブロック状態の定義（blockstates/*.json）を一覧にし、
// 日本語名・英語名・ID の一部から探す。大きな Modpack（数万ブロック）でも、一覧は一度だけ作り、結果の数を絞って返す。

import { ResourceLocation } from '../domain/resourceLocation'
import type { LangCode } from '../io/modpack/jarScanner'

/** 一覧を作るのに使うもの。Modpack がこの形を満たす */
export interface BlockCatalogSource {
  blockIds(): readonly string[]
  displayName(id: ResourceLocation, lang: LangCode): string | null
}

/** 一覧の1行 */
export interface BlockCatalogEntry {
  /** `namespace:path` */
  readonly id: string
  /** 日本語名。なければ null */
  readonly ja: string | null
  /** 英語名。なければ null */
  readonly en: string | null
}

export interface BlockCatalogResult {
  /** 合ったもの（よく合う順。limit 件まで） */
  readonly entries: readonly BlockCatalogEntry[]
  /** 合ったものの数（limit で切る前） */
  readonly total: number
}

/** 結果の数の初期値 */
export const DEFAULT_CATALOG_LIMIT = 30

/**
 * 探すための形にそろえる。全角英数字を半角に（NFKC）、小文字に、ひらがなをカタカナにする。
 * 「もーたー」でも「モーター」が見つかるようにする。
 */
export function normalizeSearchText(text: string): string {
  const s = text.normalize('NFKC').toLowerCase()
  let out = ''
  for (const c of s) {
    const code = c.charCodeAt(0)
    // ぁ(3041)〜ゖ(3096) をァ(30A1)〜ヶ(30F6) に
    out += code >= 0x3041 && code <= 0x3096 ? String.fromCharCode(code + 0x60) : c
  }
  return out
}

interface IndexedEntry {
  readonly entry: BlockCatalogEntry
  /** id・日本語名・英語名をそろえてつないだもの */
  readonly haystack: string
  /** 比べる言葉（ID、path、日本語名、英語名をそろえたもの） */
  readonly keys: readonly string[]
  /** 並べるときの長さ（短い名前を先に） */
  readonly length: number
}

const SEPARATOR = '\u0000'

export class BlockCatalog {
  private readonly items: readonly IndexedEntry[]

  constructor(entries: readonly BlockCatalogEntry[]) {
    this.items = entries.map((entry) => {
      const colon = entry.id.indexOf(':')
      const keys = [entry.id, entry.id.slice(colon + 1), entry.ja ?? '', entry.en ?? '']
        .filter((k) => k !== '')
        .map(normalizeSearchText)
      return { entry, keys, haystack: keys.join(SEPARATOR), length: (entry.ja ?? entry.en ?? entry.id).length }
    })
  }

  /** Modpack から作る。ID の名前順 */
  static fromSource(source: BlockCatalogSource): BlockCatalog {
    const entries: BlockCatalogEntry[] = []
    for (const id of source.blockIds()) {
      let rl: ResourceLocation
      try {
        rl = ResourceLocation.parse(id)
      } catch {
        continue
      }
      entries.push({ id, ja: source.displayName(rl, 'ja_jp'), en: source.displayName(rl, 'en_us') })
    }
    return new BlockCatalog(entries)
  }

  /** ブロックの数 */
  get size(): number {
    return this.items.length
  }

  /**
   * 探す。空白で区切った言葉が、どれも ID・日本語名・英語名のどれかに含まれていれば合う。
   * 並びは、名前か ID がそのまま同じもの → 言葉で始まるもの → そのほか。同じなら短い名前、ID の順。
   * 言葉がなければ何も返さない。
   */
  search(text: string, limit = DEFAULT_CATALOG_LIMIT): BlockCatalogResult {
    const whole = normalizeSearchText(text).trim()
    const terms = whole.split(/\s+/).filter((t) => t.length > 0)
    if (terms.length === 0) return { entries: [], total: 0 }
    const first = terms[0]
    const hits: { item: IndexedEntry; rank: number }[] = []
    for (const item of this.items) {
      if (!terms.every((t) => item.haystack.includes(t))) continue
      const rank = item.keys.some((k) => k === whole) ? 0 : item.keys.some((k) => k.startsWith(first)) ? 1 : 2
      hits.push({ item, rank })
    }
    hits.sort(
      (a, b) =>
        a.rank - b.rank ||
        a.item.length - b.item.length ||
        (a.item.entry.id < b.item.entry.id ? -1 : a.item.entry.id > b.item.entry.id ? 1 : 0),
    )
    return { entries: hits.slice(0, Math.max(0, limit)).map((h) => h.item.entry), total: hits.length }
  }
}

const catalogs = new WeakMap<BlockCatalogSource, BlockCatalog>()

/** source（Modpack）ごとに一度だけ一覧を作り、覚えておく */
export function blockCatalogFor(source: BlockCatalogSource): BlockCatalog {
  let catalog = catalogs.get(source)
  if (!catalog) {
    catalog = BlockCatalog.fromSource(source)
    catalogs.set(source, catalog)
  }
  return catalog
}
