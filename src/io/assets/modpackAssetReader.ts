// Modpack の jar とリソースパックから、見た目の資産（assets/<ns>/models/・blockstates/・textures/）を読む
// （docs/design.md「見た目（モデルとテクスチャ）」）。AssetReader（assetTypes.ts）の本物の実装。
//
// - どの jar・zip のリソースパックにどのファイルがあるかは、Modpack の読み込みで作った索引（JarSummary.assets）で分かる。
//   索引にない zip は開かない。
// - 中身は必要なときに部分読み（readRange）で読む。zip のファイルの一覧は最初の1回だけ読み、覚えておく。
//   同じ時に頼まれた同じ zip の項目は、まとめて読む（間の狭い項目は1回で読む）。
// - 同じパスが複数の場所にあれば、優先度の高いものを使う。順は「jar の外の翻訳」と同じ
//   （jar（名前順） < ModTranslations/ < resourcepacks/ のうち options.txt にないもの < options.txt にあるもの）。
// - 1つのファイルは小さい（JSON や 16×16 の PNG）ので、展開はその場で行う。
//   PNG の展開やモデルの解決などの重い処理は、使う側（Worker）で行う。

import { inflateSync, unzipSync } from 'fflate'
import { FileNotFoundError, normalizePath, type FileSource } from '../fileSource'
import {
  readZipDirectory,
  readZipEntries,
  ZipLayoutError,
  type CompressedZipEntry,
  type RangeReader,
  type ZipDirectory,
  type ZipDirectoryEntry,
} from '../modpack/partialZip'
import type { AssetReader } from './assetTypes'

/**
 * 資産を読む場所1つ。path は Modpack のフォルダからの相対パス（`mods/create.jar`、`resourcepacks/foo.zip`、`ModTranslations`）。
 * zip は索引（assets）にあるファイルだけを読む。フォルダは索引を持たず、頼まれたときにそのパスを読んでみる。
 * zip の source は、Modpack のフォルダの外にあるもの（Minecraft 本体の jar を選んだゲームのフォルダ）を読むときだけ渡す。
 * そのとき path は source からの相対パス
 */
export type AssetLocation =
  | {
      readonly kind: 'zip'
      readonly path: string
      readonly assets: readonly string[]
      readonly source?: FileSource
    }
  | { readonly kind: 'folder'; readonly path: string }
  /** ファイルにはなく、アプリが組み立てた資産（KubeJS のスクリプトのブロック）。files は資産のパス → 中身 */
  | { readonly kind: 'memory'; readonly path: string; readonly files: Readonly<Record<string, string>> }

/** 開いた zip。一部を読めるときは一覧だけを持ち、読めないときはファイル全体を持つ */
type OpenedZip =
  | {
      readonly kind: 'range'
      readonly reader: RangeReader
      readonly directory: ZipDirectory
      readonly entries: ReadonlyMap<string, ZipDirectoryEntry>
    }
  | { readonly kind: 'whole'; readonly bytes: Uint8Array }

interface PendingRead {
  readonly entry: ZipDirectoryEntry
  readonly resolve: (data: Uint8Array) => void
  readonly reject: (error: unknown) => void
}

/** zip を開けなかった（ファイルがない、壊れている、など） */
class ArchiveOpenError extends Error {}

class ZipArchive {
  private readonly index: ReadonlySet<string>
  private opened: Promise<OpenedZip> | null = null
  private queue: PendingRead[] = []

  constructor(
    readonly path: string,
    assets: readonly string[],
    private readonly source: FileSource,
  ) {
    this.index = new Set(assets)
  }

  has(name: string): boolean {
    return this.index.has(name)
  }

  /** zip を開く（一覧を読む）。何度呼んでも1回だけ開く */
  private open(): Promise<OpenedZip> {
    this.opened ??= this.openOnce()
    return this.opened
  }

  private async openOnce(): Promise<OpenedZip> {
    const source = this.source
    const stat = source.readRange && source.stat ? await source.stat(this.path) : null
    if (stat && source.readRange) {
      const readRange = source.readRange.bind(source)
      const path = this.path
      const reader: RangeReader = {
        size: stat.size,
        read: async (start, end) => new Uint8Array(await readRange(path, start, end)),
      }
      try {
        const directory = await readZipDirectory(reader, (name) => this.index.has(name))
        return { kind: 'range', reader, directory, entries: new Map(directory.entries.map((e) => [e.name, e])) }
      } catch (e) {
        if (!(e instanceof ZipLayoutError)) throw e
        // 想定と違う形の zip は、ファイル全体を読む方法に戻す
      }
    }
    const bytes = new Uint8Array(await source.read(this.path))
    // zip として読めるかを、展開せずに確かめておく（壊れていれば開けなかった扱いにする）
    unzipSync(bytes, { filter: () => false })
    return { kind: 'whole', bytes }
  }

  /** 項目を読んで展開する。zip にない項目なら null */
  async read(name: string): Promise<Uint8Array | null> {
    let opened: OpenedZip
    try {
      opened = await this.open()
    } catch (e) {
      throw new ArchiveOpenError(errorText(e))
    }
    if (opened.kind === 'whole') {
      return unzipSync(opened.bytes, { filter: (f) => f.name === name })[name] ?? null
    }
    const entry = opened.entries.get(name)
    if (!entry) return null
    const compressed = await new Promise<Uint8Array>((resolve, reject) => {
      this.queue.push({ entry, resolve, reject })
      // 同じ時に頼まれた項目をまとめて読む
      if (this.queue.length === 1) queueMicrotask(() => void this.flush(opened))
    })
    return inflateEntry({ ...entry, data: compressed })
  }

  private async flush(opened: Extract<OpenedZip, { kind: 'range' }>): Promise<void> {
    const batch = this.queue
    this.queue = []
    const unique = [...new Map(batch.map((p) => [p.entry.name, p.entry])).values()]
    try {
      const read = await readZipEntries(opened.reader, opened.directory, unique)
      const byName = new Map(read.map((e) => [e.name, e.data]))
      for (const p of batch) p.resolve(byName.get(p.entry.name) ?? new Uint8Array(0))
    } catch (e) {
      for (const p of batch) p.reject(e)
    }
  }
}

function inflateEntry(entry: CompressedZipEntry): Uint8Array {
  if (entry.compression === 0) return entry.data.slice()
  if (entry.compression === 8) return inflateSync(entry.data, { out: new Uint8Array(entry.originalSize) })
  throw new Error(`圧縮の方式（${entry.compression}）に対応していません`)
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

const decoder = new TextDecoder('utf-8')

export class ModpackAssetReader implements AssetReader {
  /** 読めなかった zip やファイル（`<場所>: <内容>`）。読めなかったものは、次に優先度の高い場所を探す */
  readonly problems: string[] = []

  /** 優先度の高い順 */
  private readonly locations: readonly (ZipArchive | Exclude<AssetLocation, { kind: 'zip' }>)[]
  private readonly source: FileSource | null
  /** 開けなかった zip。2回目からは読まない */
  private readonly broken = new Set<string>()

  /**
   * source は Modpack のフォルダ。null なら、自分の source を持つ場所（本体の jar）しか読めない。
   * locations は優先度の低い順に渡す（後ろのものほど優先）
   */
  constructor(source: FileSource | null, locations: readonly AssetLocation[]) {
    this.source = source
    const usable: (ZipArchive | Exclude<AssetLocation, { kind: 'zip' }>)[] = []
    for (const l of locations) {
      if (l.kind === 'zip') {
        const from = l.source ?? source
        if (from) usable.push(new ZipArchive(l.path, l.assets, from))
      } else if (l.kind === 'memory' || source) {
        usable.push(l)
      }
    }
    this.locations = usable.reverse()
  }

  async readText(path: string): Promise<string | null> {
    const bytes = await this.readBytes(path)
    if (!bytes) return null
    const text = decoder.decode(bytes)
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  }

  async readBytes(path: string): Promise<Uint8Array | null> {
    let name: string
    try {
      name = normalizePath(path)
    } catch {
      return null
    }
    if (!name.startsWith('assets/')) return null
    for (const location of this.locations) {
      if (location instanceof ZipArchive) {
        if (!location.has(name) || this.broken.has(location.path)) continue
        try {
          const bytes = await location.read(name)
          if (bytes) return bytes
        } catch (e) {
          if (e instanceof ArchiveOpenError) {
            this.broken.add(location.path)
            this.problems.push(`${location.path}: 開けませんでした（${e.message}）`)
          } else {
            this.problems.push(`${location.path}: ${name} を読めませんでした（${errorText(e)}）`)
          }
        }
      } else if (location.kind === 'memory') {
        const text = location.files[name]
        if (text !== undefined) return new TextEncoder().encode(text)
      } else {
        const bytes = await this.readFolder(location.path, name)
        if (bytes) return bytes
      }
    }
    return null
  }

  private async readFolder(dir: string, name: string): Promise<Uint8Array | null> {
    if (!this.source) return null
    try {
      return new Uint8Array(await this.source.read(`${dir}/${name}`))
    } catch (e) {
      if (!(e instanceof FileNotFoundError)) {
        this.problems.push(`${dir}: ${name} を読めませんでした（${errorText(e)}）`)
      }
      return null
    }
  }
}
