// Modpack のフォルダの mods/*.jar を読み、Modpack を作る（docs/design.md「Modpack / ModpackLoader」）。
// jar の外の翻訳（resourcepacks/ と ModTranslations/）も読み、jar の翻訳の上に重ねる（langPacks.ts）。
// jar を開く処理（scan）は差し替えられる。画面では Web Worker で開き、テストではその場で開く。
// 読んだ結果は jar ごとに保存し（JarCache）、2回目からは変わった jar だけを読み直す。

import { isDirectoryEntry, type FileSource, type FileStat } from '../fileSource'
import { scanJar, type JarSummary } from './jarScanner'
import { findLangPacks, hasNames, langPackFromSummary, readFolderLangPack, type LangPack, type LangPackLocation } from './langPacks'
import { Modpack, type ModpackProblem } from './modpack'
import { MODS_DIR } from './modpackFolder'

/** jar を開いて読む関数。bytes は渡したあと使わない（Worker へ移してよい） */
export type JarScanner = (jar: string, bytes: Uint8Array) => Promise<JarSummary>

/** jar ごとの読んだ結果の保存先。ブラウザでは IndexedDB（indexedDbJarCache.ts） */
export interface JarCache {
  get(key: string): Promise<JarSummary | null>
  put(key: string, summary: JarSummary): Promise<void>
}

/** 読み込みの進み具合 */
export interface ModpackLoadProgress {
  /** 終わった jar とリソースパックの数 */
  readonly done: number
  /** jar とリソースパック（ModTranslations/ を含む）の数 */
  readonly total: number
  /** 保存した結果を使った jar と zip のリソースパックの数 */
  readonly fromCache: number
  /** いま読んでいる jar のファイル名、またはリソースパックのパス。終わったら null */
  readonly current: string | null
}

export interface ModpackLoaderOptions {
  /** 保存先。null なら毎回すべて読む */
  cache?: JarCache | null
  /** jar を開く関数。省略するとその場で開く（scanJar） */
  scan?: JarScanner
  onProgress?: (progress: ModpackLoadProgress) => void
  /** 途中でやめる合図。やめたら load は AbortError を投げる */
  signal?: AbortSignal
}

/**
 * 保存した結果の形を変えたら上げる。上げると、保存した結果はすべて読み直しになる。
 */
export const JAR_SUMMARY_FORMAT = 1

/** 読み込みを途中でやめたときのエラー */
export class ModpackLoadAbortedError extends Error {
  constructor() {
    super('Modpack の読み込みをやめました')
    this.name = 'AbortError'
  }
}

/** FNV-1a（32bit）。jar の変化を見分けるためだけに使う */
function fnv1a(bytes: Uint8Array, start: number, end: number): string {
  let h = 0x811c9dc5
  for (let i = start; i < end; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** jar の末尾から見る範囲。zip は末尾に全ファイルの CRC の一覧（central directory）を持つ */
const TAIL_BYTES = 256 * 1024

/**
 * 保存の鍵。ファイルの大きさと更新時刻が分かればそれを使う（中身を読まずに済む）。
 * 分からなければ、大きさと末尾（ファイルの一覧と CRC がある）から作る。
 */
export function jarCacheKey(jar: string, stat: FileStat | null, bytes: Uint8Array | null): string {
  const base = `v${JAR_SUMMARY_FORMAT}|${jar}`
  if (stat) return `${base}|${stat.size}|${stat.lastModified}`
  if (bytes) {
    const start = Math.max(0, bytes.length - TAIL_BYTES)
    return `${base}|${bytes.length}|h${fnv1a(bytes, start, bytes.length)}`
  }
  throw new Error('jar の大きさも中身も分からないため、保存の鍵を作れません')
}

function isJar(name: string): boolean {
  return !isDirectoryEntry(name) && name.toLowerCase().endsWith('.jar')
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export class ModpackLoader {
  private readonly source: FileSource
  private readonly cache: JarCache | null
  private readonly scan: JarScanner
  private readonly onProgress: ((progress: ModpackLoadProgress) => void) | null
  private readonly signal: AbortSignal | null

  constructor(source: FileSource, options: ModpackLoaderOptions = {}) {
    this.source = source
    this.cache = options.cache ?? null
    this.scan = options.scan ?? (async (jar, bytes) => scanJar(jar, bytes))
    this.onProgress = options.onProgress ?? null
    this.signal = options.signal ?? null
  }

  /**
   * mods/*.jar を開き、Mod の情報と表示名を集める。続けて resourcepacks/ と ModTranslations/ の翻訳を読む。
   * mods/ がなければ FileNotFoundError を投げる。読めない jar やパックは Modpack.problems に入れて続ける。
   */
  async load(): Promise<Modpack> {
    const jars = (await this.source.list(MODS_DIR)).filter(isJar).sort()
    const packLocations = await findLangPacks(this.source)
    const total = jars.length + packLocations.length
    const summaries: JarSummary[] = []
    const langPacks: LangPack[] = []
    const problems: ModpackProblem[] = []
    let fromCache = 0

    for (let i = 0; i < jars.length; i++) {
      this.throwIfAborted()
      const jar = jars[i]
      this.onProgress?.({ done: i, total, fromCache, current: jar })
      try {
        const result = await this.loadArchive(`${MODS_DIR}/${jar}`, jar)
        summaries.push(result.summary)
        if (result.cached) fromCache++
      } catch (e) {
        if (e instanceof ModpackLoadAbortedError) throw e
        problems.push({ jar, message: `jar を読めませんでした（${errorText(e)}）` })
      }
    }

    for (let i = 0; i < packLocations.length; i++) {
      this.throwIfAborted()
      const location = packLocations[i]
      this.onProgress?.({ done: jars.length + i, total, fromCache, current: location.path })
      try {
        const result = await this.loadLangPack(location)
        if (hasNames(result.pack) || result.pack.problems.length > 0) langPacks.push(result.pack)
        if (result.cached) fromCache++
      } catch (e) {
        if (e instanceof ModpackLoadAbortedError) throw e
        problems.push({ jar: location.path, message: `リソースパックを読めませんでした（${errorText(e)}）` })
      }
    }

    this.throwIfAborted()
    this.onProgress?.({ done: total, total, fromCache, current: null })
    return new Modpack(summaries, this.source, problems, langPacks)
  }

  private async loadLangPack(location: LangPackLocation): Promise<{ pack: LangPack; cached: boolean }> {
    if (location.kind === 'folder') {
      return { pack: await readFolderLangPack(this.source, location.path), cached: false }
    }
    // zip のリソースパックは jar と同じく開いて保存する。保存の鍵はパスで jar と分ける
    const result = await this.loadArchive(location.path, location.path, true)
    return { pack: langPackFromSummary(location.path, result.summary), cached: result.cached }
  }

  /**
   * zip（jar またはリソースパック）を開いて読む。jar は保存の鍵と結果に使う名前。
   * langOnly なら、保存する前に翻訳以外（Mod の情報、namespace、ブロック状態の定義）を捨てる。
   */
  private async loadArchive(
    path: string,
    jar: string,
    langOnly = false,
  ): Promise<{ summary: JarSummary; cached: boolean }> {
    const stat = this.source.stat ? await this.source.stat(path) : null

    // 大きさと更新時刻が分かれば、中身を読む前に保存した結果を探す
    if (stat && this.cache) {
      const hit = await this.cache.get(jarCacheKey(jar, stat, null))
      if (hit) return { summary: hit, cached: true }
    }

    const bytes = new Uint8Array(await this.source.read(path))
    this.throwIfAborted()
    const key = this.cache ? jarCacheKey(jar, stat, bytes) : null
    if (key !== null && !stat && this.cache) {
      const hit = await this.cache.get(key)
      if (hit) return { summary: hit, cached: true }
    }

    const scanned = await this.scan(jar, bytes)
    const summary = langOnly ? { ...scanned, mods: [], namespaces: [], blockStates: {} } : scanned
    if (key !== null && this.cache) {
      try {
        await this.cache.put(key, summary)
      } catch {
        // 保存できなくても、次回また読むだけで済む
      }
    }
    return { summary, cached: false }
  }

  private throwIfAborted(): void {
    if (this.signal?.aborted) throw new ModpackLoadAbortedError()
  }
}

/** 保存先をメモリに持つ JarCache。テストと、IndexedDB が使えないときに使う */
export class MemoryJarCache implements JarCache {
  readonly entries = new Map<string, JarSummary>()

  async get(key: string): Promise<JarSummary | null> {
    return this.entries.get(key) ?? null
  }

  async put(key: string, summary: JarSummary): Promise<void> {
    this.entries.set(key, summary)
  }
}
