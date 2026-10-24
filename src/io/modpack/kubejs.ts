// KubeJS が足すブロック（docs/design.md「Modpack / ModpackLoader」の「KubeJS が足すブロック」）。
// Modpack によっては、jar ではなく KubeJS のスクリプトでブロックを登録し、資産を kubejs/assets/ に置いている
// （Create Astral の `createastral:` など）。スクリプトは実行せず、文字列で次を読む。
// - 登録の呼び出し（`.create("<ns>:<path>")`）の namespace
// - ブロックの登録（`onEvent('block.registry', …)`）の中の、各ブロックのテクスチャ（`.textureAll`・`.texture`）とモデル（`.model`）
// ブロックの blockstates とモデルは、ゲームの KubeJS と同じく、ここで組み立てる（kubeJsBlockAssets）。
// 翻訳と、利用者が置いた見た目の資産は、kubejs/ をフォルダのリソースパックとして読む（langPacks.ts）。

import { DIRECTIONS, type Direction } from '../../domain/direction'
import { FileNotFoundError, isDirectoryEntry, type FileSource } from '../fileSource'

/** KubeJS のフォルダ。中の `assets/<namespace>/` はリソースパックと同じ形 */
export const KUBEJS_DIR = 'kubejs'
/** ゲームの起動時に動き、ブロックやアイテムを登録するスクリプトのフォルダ */
export const KUBEJS_STARTUP_DIR = `${KUBEJS_DIR}/startup_scripts`

/** 深すぎるフォルダはたどらない */
const MAX_DEPTH = 8

/** `event.create("createastral:foo")`、`e.create('ns:path', 'basic')` など。ID は小文字の ResourceLocation */
const CREATE_CALL = /\.create\(\s*(["'`])([a-z0-9_.-]+):[a-z0-9_./-]+\1/g

/** スクリプトの文字列から、登録している ID の namespace を取り出す（名前順） */
export function registeredNamespaces(script: string): string[] {
  const out = new Set<string>()
  for (const m of script.matchAll(CREATE_CALL)) out.add(m[2])
  return [...out].sort()
}

/** スクリプトで登録したブロック1つ */
export interface KubeJsBlock {
  /** namespace 付きの ID。namespace がなければ `kubejs:` */
  readonly id: string
  /** 面ごとのテクスチャ（namespace 付き）。書いていない面は ID から決まる既定のもの */
  readonly textures: Readonly<Record<Direction, string>>
  /** `.model(…)` で決めたモデルの ID。なければ null（textures から立方体のモデルを組み立てる） */
  readonly model: string | null
}

/** 文字列のくくり（' " `） */
const Q = `(["'\`])`

/** イベントの始まり。1.18 の `onEvent('block.registry', …)` と、1.19.2 からの `StartupEvents.registry('block', …)` */
const EVENT_START = new RegExp(`(?:onEvent\\(\\s*${Q}([\\w.]+)\\1|StartupEvents\\.registry\\(\\s*${Q}(\\w+)\\3)`, 'g')
/** ブロックの登録。種類（2つ目の引数）は省略できる */
const BLOCK_CREATE = new RegExp(`\\.create\\(\\s*${Q}([^"'\`]+)\\1\\s*(?:,\\s*${Q}([^"'\`]+)\\3\\s*)?\\)`, 'g')
const TEXTURE_ALL = new RegExp(`\\.textureAll\\(\\s*${Q}([^"'\`]+)\\1\\s*\\)`, 'g')
const TEXTURE_SIDE = new RegExp(`\\.texture\\(\\s*${Q}([a-z]+)\\1\\s*,\\s*${Q}([^"'\`]+)\\3\\s*\\)`, 'g')
const MODEL = new RegExp(`\\.model\\(\\s*${Q}([^"'\`]+)\\1\\s*\\)`, 'g')

/** 立方体として組み立てる種類。ほか（slab・stairs・wall など）は形が違うので組み立てない */
const CUBE_TYPES: readonly string[] = ['basic']

function withNamespace(id: string, fallback: string): string {
  return id.includes(':') ? id : `${fallback}:${id}`
}

/**
 * スクリプトの文字列から、ブロックの登録を読む（ブロックの登録のイベントの中だけ。アイテムは読まない）。
 * 立方体のもの（種類が basic か省略）だけを返す
 */
export function registeredBlocks(script: string): KubeJsBlock[] {
  const events = [...script.matchAll(EVENT_START)]
  const out: KubeJsBlock[] = []
  events.forEach((e, i) => {
    const isBlockRegistry = e[2] === 'block.registry' || e[4] === 'block'
    if (!isBlockRegistry) return
    const segment = script.slice(e.index!, i + 1 < events.length ? events[i + 1]!.index : script.length)
    const creates = [...segment.matchAll(BLOCK_CREATE)]
    creates.forEach((c, j) => {
      const type = c[4] ?? 'basic'
      if (!CUBE_TYPES.includes(type)) return
      const id = withNamespace(c[2]!, 'kubejs')
      // そのブロックの設定は、次の .create( までに書いてある
      const body = segment.slice(c.index! + c[0].length, j + 1 < creates.length ? creates[j + 1]!.index : segment.length)
      const colon = id.indexOf(':')
      const fallback = `${id.slice(0, colon)}:block/${id.slice(colon + 1)}`
      const textures = Object.fromEntries(DIRECTIONS.map((d) => [d, fallback])) as Record<Direction, string>
      // 書いた順に当てる（textureAll のあとの texture が勝つ。逆も同じ）
      const calls = [
        ...[...body.matchAll(TEXTURE_ALL)].map((m) => ({ at: m.index!, side: 'all', texture: m[2]! })),
        ...[...body.matchAll(TEXTURE_SIDE)].map((m) => ({ at: m.index!, side: m[2]!, texture: m[4]! })),
      ].sort((a, b) => a.at - b.at)
      for (const call of calls) {
        const texture = withNamespace(call.texture, 'minecraft')
        if (call.side === 'all') for (const d of DIRECTIONS) textures[d] = texture
        else if ((DIRECTIONS as readonly string[]).includes(call.side)) textures[call.side as Direction] = texture
      }
      const model = [...body.matchAll(MODEL)].at(-1)?.[2]
      out.push({ id, textures, model: model ? withNamespace(model, 'minecraft') : null })
    })
  })
  return out
}

/**
 * スクリプトのブロックの blockstates とモデルの JSON（資産のパス → 中身）。ゲームの KubeJS が組み立てるものと同じ形。
 * - blockstates は状態なし（`""`）で、`.model` があればそれを、なければ `<ns>:block/<path>` を指す
 * - モデルは、6面が同じテクスチャなら `block/cube_all`、違えば `block/cube`。particle は北の面
 */
export function kubeJsBlockAssets(blocks: readonly KubeJsBlock[]): Record<string, string> {
  const files: Record<string, string> = {}
  for (const b of blocks) {
    const colon = b.id.indexOf(':')
    const ns = b.id.slice(0, colon)
    const path = b.id.slice(colon + 1)
    const modelId = b.model ?? `${ns}:block/${path}`
    files[`assets/${ns}/blockstates/${path}.json`] = JSON.stringify({ variants: { '': { model: modelId } } })
    if (b.model !== null) continue
    const all = DIRECTIONS.every((d) => b.textures[d] === b.textures.north)
    const model = all
      ? { parent: 'minecraft:block/cube_all', textures: { all: b.textures.north } }
      : { parent: 'minecraft:block/cube', textures: { ...b.textures, particle: b.textures.north } }
    files[`assets/${ns}/models/block/${path}.json`] = JSON.stringify(model)
  }
  return files
}

/** KubeJS のスクリプトを読んだ結果 */
export interface KubeJsStartup {
  /** スクリプトで登録している namespace（名前順） */
  readonly namespaces: string[]
  /** スクリプトで登録している立方体のブロック（読んだ順。同じ ID は後のものを使う） */
  readonly blocks: KubeJsBlock[]
  /** 読めなかったスクリプト（`kubejs/startup_scripts/foo.js: 内容`）。読み込みは続ける */
  readonly problems: string[]
}

/**
 * kubejs/startup_scripts/ の .js（下のフォルダも含む）から、登録している namespace とブロックを集める。
 * フォルダがなければ空の結果を返す。
 */
export async function readKubeJsStartup(source: FileSource): Promise<KubeJsStartup> {
  const namespaces = new Set<string>()
  const blocks = new Map<string, KubeJsBlock>()
  const problems: string[] = []
  const decoder = new TextDecoder('utf-8')

  const visit = async (dir: string, depth: number): Promise<void> => {
    let names: string[]
    try {
      names = await source.list(dir)
    } catch (e) {
      if (e instanceof FileNotFoundError) return
      throw e
    }
    for (const name of [...names].sort()) {
      if (isDirectoryEntry(name)) {
        if (depth < MAX_DEPTH) await visit(`${dir}/${name.slice(0, -1)}`, depth + 1)
        continue
      }
      if (!name.toLowerCase().endsWith('.js')) continue
      const path = `${dir}/${name}`
      try {
        const script = decoder.decode(await source.read(path))
        for (const ns of registeredNamespaces(script)) namespaces.add(ns)
        for (const b of registeredBlocks(script)) blocks.set(b.id, b)
      } catch (e) {
        problems.push(`${path}: 読めません（${e instanceof Error ? e.message : String(e)}）`)
      }
    }
  }

  await visit(KUBEJS_STARTUP_DIR, 0)
  return { namespaces: [...namespaces].sort(), blocks: [...blocks.values()], problems }
}
