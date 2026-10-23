// 本物の AppearanceProvider（docs/design.md「見た目（モデルとテクスチャ）」）。
// AssetReader から、モデルの解決（ModelResolver）とアトラス作り（TextureAtlasBuilder）を合わせて AppearanceSet を作る。
// どこで動くか（Worker の中か、画面と同じスレッドか）は知らない。Worker で動かすときは workers/appearanceWorkerHost.ts が使う。

import type { AppearanceSet, BlockAppearance, TextureId } from '../../domain/blockModel'
import type { BlockState } from '../../domain/blockState'
import type { AppearanceProvider, AssetReader } from './assetTypes'
import { ModelResolver } from './modelResolver'
import { TextureAtlasBuilder, type TextureAtlasOptions } from './textureAtlas'

const decoder = new TextDecoder('utf-8')

/**
 * 読んだファイルを覚えておく AssetReader。アトラスは状態が増えるたびに作り直すので、
 * 同じ PNG を2度読まないようにする（Worker では読むたびに画面側へ問い合わせるため）
 */
export class CachingAssetReader implements AssetReader {
  private readonly bytes = new Map<string, Promise<Uint8Array | null>>()

  constructor(private readonly inner: AssetReader) {}

  get problems(): readonly string[] {
    return this.inner.problems ?? []
  }

  readBytes(path: string): Promise<Uint8Array | null> {
    let p = this.bytes.get(path)
    if (!p) {
      p = this.inner.readBytes(path)
      // 失敗は覚えない（次に頼まれたら読み直す）
      p.catch(() => this.bytes.delete(path))
      this.bytes.set(path, p)
    }
    return p
  }

  async readText(path: string): Promise<string | null> {
    const bytes = await this.readBytes(path)
    if (bytes === null) return null
    const text = decoder.decode(bytes)
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  }
}

/** 見た目に出てくるテクスチャの ID（重なりなし） */
export function textureIdsOf(appearances: Iterable<BlockAppearance | null>): Set<TextureId> {
  const ids = new Set<TextureId>()
  for (const a of appearances) {
    if (!a) continue
    for (const part of a.parts) {
      for (const element of part.model.elements) {
        for (const face of Object.values(element.faces)) if (face) ids.add(face.texture)
      }
    }
  }
  return ids
}

/** 重なりを除いて、出てきた順に並べる */
export function uniqueProblems(...lists: readonly (readonly string[])[]): string[] {
  return [...new Set(lists.flat())]
}

/**
 * AssetReader から見た目を用意する。モデルの解決の結果と、読んだファイルは覚えておく。
 * prepare のたびに、渡された状態のテクスチャだけでアトラスを作り直す
 */
export class AssetAppearanceProvider implements AppearanceProvider {
  private readonly reader: CachingAssetReader
  private readonly resolver: ModelResolver
  private readonly atlasBuilder: TextureAtlasBuilder

  constructor(reader: AssetReader, options: TextureAtlasOptions = {}) {
    this.reader = new CachingAssetReader(reader)
    this.resolver = new ModelResolver(this.reader)
    this.atlasBuilder = new TextureAtlasBuilder(this.reader, options)
  }

  async prepare(states: readonly BlockState[]): Promise<AppearanceSet> {
    const appearances = await this.resolver.resolveAll(states)
    const { atlas, problems } = await this.atlasBuilder.build(textureIdsOf(Object.values(appearances)))
    return {
      appearances,
      atlas,
      problems: uniqueProblems(this.resolver.problems, problems, this.reader.problems),
    }
  }
}

/**
 * 用意した見た目を覚えておく provider（Modpack ごとに1つ作る）。
 * - これまでに頼まれた状態をすべて覚え、知らない状態が来たときだけ、全部の状態で inner に頼み直す
 * - 知っている状態だけなら、前の結果をそのまま返す（設計図を開き直したとき、状態の少ない設計図を開いたとき）
 * 結果には頼まれていない状態も入るが、画面は鍵で引くだけなので困らない
 */
export class CachedAppearanceProvider implements AppearanceProvider {
  private readonly known = new Map<string, BlockState>()
  private last: Promise<AppearanceSet> | null = null

  constructor(private readonly inner: AppearanceProvider) {}

  prepare(states: readonly BlockState[]): Promise<AppearanceSet> {
    let added = false
    for (const s of states) {
      if (this.known.has(s.key)) continue
      this.known.set(s.key, s)
      added = true
    }
    if (!added && this.last) return this.last
    const p = this.inner.prepare([...this.known.values()])
    this.last = p
    // 失敗したら覚えない（次に頼まれたら作り直す）
    p.catch(() => {
      if (this.last === p) this.last = null
    })
    return p
  }
}
