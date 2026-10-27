// アイテムのタグ（#127）。jar・データパックの data/<namespace>/tags/items/（1.21 は tags/item/）の JSON を読み、
// 読み込みの順にまとめ、入れ子のタグ（`#forge:ores`）をたどって、タグ → アイテムの ID の一覧にする。
// レシピの材料のタグ（`forge:ores/iron`）がどのアイテムを指すかを調べるのに使う。

/** jar・データパックの中のアイテムのタグのパス。1: namespace、2: tags/items/ の下のパス（.json なし） */
export const ITEM_TAG_PATH = /^data\/([^/]+)\/tags\/items?\/(.+)\.json$/

/**
 * タグのファイル1つ分（または、同じタグのファイルを読み込みの順にまとめたもの）。
 * IndexedDB に保存し、Worker にも送るので、ただのデータだけにする
 */
export interface ItemTagFile {
  /** true なら、前に読んだ同じタグの中身を捨てる */
  readonly replace: boolean
  /** アイテムの ID（`minecraft:iron_ore`）か、入れ子のタグ（`#forge:ores/iron`） */
  readonly values: string[]
}

/** タグの名前（`#` なし）→ タグのファイル */
export type ItemTagFiles = Record<string, ItemTagFile>

/**
 * タグの JSON を読む。形が違えば null。
 * values の項目は文字列か `{ id, required }`（id だけを使う）。namespace のない ID は `minecraft:` を付ける
 */
export function readItemTagFile(data: unknown): ItemTagFile | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const obj = data as Record<string, unknown>
  if (!Array.isArray(obj.values)) return null
  const values: string[] = []
  for (const v of obj.values) {
    const id = typeof v === 'string' ? v : isObject(v) && typeof v.id === 'string' ? v.id : null
    if (id !== null && id.length > 0) values.push(withNamespace(id))
  }
  return { replace: obj.replace === true, values }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function withNamespace(id: string): string {
  const tag = id.startsWith('#')
  const name = tag ? id.slice(1) : id
  const full = name.includes(':') ? name : `minecraft:${name}`
  return tag ? `#${full}` : full
}

/**
 * 同じタグのファイルを、読み込みの順に1つにまとめる。後のファイルは値を足す。
 * 後のファイルが replace なら、前の値を捨てる（まとめた結果も replace になり、さらに前のものを捨てる）
 */
export function mergeItemTagFile(earlier: ItemTagFile | undefined, later: ItemTagFile): ItemTagFile {
  if (!earlier || later.replace) return { replace: later.replace, values: unique(later.values) }
  return { replace: earlier.replace, values: unique([...earlier.values, ...later.values]) }
}

/** タグのファイルの集まりを、読み込みの順にまとめる。target を書き換える */
export function mergeItemTagFiles(target: ItemTagFiles, later: Readonly<ItemTagFiles>): ItemTagFiles {
  for (const [tag, file] of Object.entries(later)) {
    target[tag] = mergeItemTagFile(Object.hasOwn(target, tag) ? target[tag] : undefined, file)
  }
  return target
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

/**
 * 入れ子のタグをたどって、タグ（`#` なし）→ アイテムの ID の一覧にする。
 * 知らないタグを指していれば、そこは飛ばす。タグが輪になっていても止まる（輪の先は飛ばす）
 */
export function flattenItemTags(files: Readonly<ItemTagFiles>): Record<string, string[]> {
  const done = new Map<string, string[]>()
  const visiting = new Set<string>()

  // complete が false なら、輪のせいで途中までしかたどれていない。その結果は覚えずに、輪の外から読み直す
  const resolve = (tag: string): { items: string[]; complete: boolean } => {
    const hit = done.get(tag)
    if (hit) return { items: hit, complete: true }
    if (visiting.has(tag)) return { items: [], complete: false }
    if (!Object.hasOwn(files, tag)) return { items: [], complete: true }
    visiting.add(tag)
    const items = new Set<string>()
    let complete = true
    for (const v of files[tag].values) {
      if (!v.startsWith('#')) {
        items.add(v)
        continue
      }
      const nested = resolve(v.slice(1))
      for (const item of nested.items) items.add(item)
      if (!nested.complete) complete = false
    }
    visiting.delete(tag)
    const out = [...items]
    if (complete) done.set(tag, out)
    return { items: out, complete }
  }

  const result: Record<string, string[]> = {}
  for (const tag of Object.keys(files).sort()) result[tag] = resolve(tag).items
  return result
}
