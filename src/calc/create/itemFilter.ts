// フィルター（docs/create-throughput.md「フィルター（#253）」、TP-FILTER）。
// ファンネル・ベルトのファンネル・真鍮のトンネルの生データにあるフィルターの物を読み、物を通すかを決める。

import type { NbtCompound } from '../../domain/nbt'
import { nbtBoolean, nbtCompound, nbtNumber, nbtString } from '../nbtValues'

/** フィルターで物を通すか。unknown はフィルターが読めなかったとき（通すとして仮定に載せる） */
export interface FilterTest {
  readonly pass: boolean
  /** 読めなかったフィルターの ID（属性フィルターなど） */
  readonly unknown: string | null
}

const PASS: FilterTest = { pass: true, unknown: null }
const LIST_FILTER = 'create:filter'
/** リストフィルターの中の物（1.21.1 の data component） */
const FILTER_ITEMS = 'create:filter_items'
const FILTER_BLACKLIST = 'create:filter_items_blacklist'
/** 中のフィルターを読む深さの上限（フィルターの中のフィルター） */
const MAX_DEPTH = 4

/** フィルターの物（アイテムスタック。なければ null）が item を通すか */
export function testFilter(filter: NbtCompound | null, item: string): FilterTest {
  return test(filter, item, 0)
}

function test(filter: NbtCompound | null, item: string, depth: number): FilterTest {
  if (!filter) return PASS
  const id = nbtString(filter, 'id')
  const count = nbtNumber(filter, 'Count') ?? nbtNumber(filter, 'count') ?? 1
  if (!id || id === 'minecraft:air' || count <= 0) return PASS
  if (id === LIST_FILTER && depth < MAX_DEPTH) {
    const list = listFilter(filter)
    if (list.items.length > 0) {
      let unknown: string | null = null
      for (const inner of list.items) {
        const t = test(inner, item, depth + 1)
        unknown ??= t.unknown
        if (t.pass && t.unknown === null) return { pass: !list.blacklist, unknown }
      }
      return { pass: unknown !== null || list.blacklist, unknown }
    }
    return { pass: item === id, unknown: null }
  }
  if (id.endsWith('_filter') || id === LIST_FILTER) return { pass: true, unknown: id }
  return { pass: item === id, unknown: null }
}

/** リストフィルターの中の物と、通さない一覧か。1.18.2 は tag、1.21.1 は components */
function listFilter(filter: NbtCompound): { items: NbtCompound[]; blacklist: boolean } {
  const items: NbtCompound[] = []
  const tag = nbtCompound(filter, 'tag')
  if (tag) {
    const inv = nbtCompound(tag, 'Items')
    const list = inv?.value.get('Items')
    if (list?.type === 'list') for (const e of list.value) if (e.type === 'compound') items.push(e)
    return { items, blacklist: nbtBoolean(tag, 'Blacklist') ?? false }
  }
  const components = nbtCompound(filter, 'components')
  if (components) {
    const list = components.value.get(FILTER_ITEMS)
    if (list?.type === 'list') {
      for (const e of list.value) {
        if (e.type !== 'compound') continue
        const stack = nbtCompound(e, 'item')
        if (stack) items.push(stack)
      }
    }
    return { items, blacklist: nbtBoolean(components, FILTER_BLACKLIST) ?? false }
  }
  return { items, blacklist: false }
}
