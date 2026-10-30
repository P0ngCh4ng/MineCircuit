// 置くブロックの棚の中身（docs/ui.md「編集」）。画面に依存しない計算だけを置く。
// - 選択肢（「Mod」の欄で選ぶ）：「この設計図」と、Modpack の Mod（namespace）ごと。設計図で使っている Mod を先に、残りを名前順。
//   Modpack がなければ、代わりに「基本の部品」（計算プラグインの basicBlocks。#162）
// - 中身：この設計図ならブロック状態そのもの、Mod ならブロック状態の定義の最初の組み合わせ。表示名の順
// - 絞り込み：日本語名・英語名・ID に、空白で区切った言葉がすべて入っているもの

import { BlockState } from '../../domain/blockState'
import { ResourceLocation } from '../../domain/resourceLocation'
import { initialPropertiesFor, type BlockStateDefinitionSource } from '../../edit/orientationOptions'
import type { ModInfo } from '../../io/modpack/modMetadata'

/** 「この設計図」の選択肢の id */
export const BLUEPRINT_TAB = 'blueprint'
/** 「基本の部品」の選択肢の id（Modpack がないとき。#162） */
export const BASIC_TAB = 'basic'

/** 基本の部品1つ分。状態と、アプリで書いた名前 */
export interface BasicShelfBlock {
  readonly state: BlockState
  readonly name: string
}

export interface ShelfTab {
  /** `blueprint` か `ns:<namespace>` */
  readonly id: string
  readonly label: string
}

export interface ShelfItem {
  readonly state: BlockState
  /** ブロックの ID（`create:shaft`） */
  readonly id: string
  readonly ja: string | null
  readonly en: string | null
}

/** 棚に使う Modpack の部分 */
export interface ShelfModpack extends BlockStateDefinitionSource {
  readonly mods: readonly ModInfo[]
  blockIds(): string[]
  displayName(id: ResourceLocation, lang: 'ja_jp' | 'en_us'): string | null
}

function namespaceOf(id: string): string {
  const colon = id.indexOf(':')
  return colon < 0 ? 'minecraft' : id.slice(0, colon)
}

/** Mod の選択肢の名前。namespace と同じ modId の Mod の表示名。なければ namespace */
export function modLabel(pack: ShelfModpack, ns: string): string {
  if (ns === 'minecraft') return 'Minecraft'
  return pack.mods.find((m) => m.modId === ns)?.name ?? ns
}

/** 選択肢の一覧。Modpack がなければ「この設計図」と、基本の部品があれば「基本の部品」 */
export function shelfTabs(
  pack: ShelfModpack | null,
  blueprintNamespaces: ReadonlySet<string>,
  hasBasic = false,
): ShelfTab[] {
  const tabs: ShelfTab[] = [{ id: BLUEPRINT_TAB, label: 'この設計図' }]
  if (!pack) {
    if (hasBasic) tabs.push({ id: BASIC_TAB, label: '基本の部品' })
    return tabs
  }
  const namespaces = [...new Set(pack.blockIds().map(namespaceOf))]
  const used = namespaces.filter((ns) => blueprintNamespaces.has(ns))
  const rest = namespaces.filter((ns) => !blueprintNamespaces.has(ns))
  const byLabel = (a: string, b: string) => modLabel(pack, a).localeCompare(modLabel(pack, b), 'ja')
  for (const ns of [...used.sort(byLabel), ...rest.sort(byLabel)]) tabs.push({ id: `ns:${ns}`, label: modLabel(pack, ns) })
  return tabs
}

/** 表示名（日本語 → 英語 → ID）で並べる */
function compareItems(a: ShelfItem, b: ShelfItem): number {
  return (a.ja ?? a.en ?? a.id).localeCompare(b.ja ?? b.en ?? b.id, 'ja') || a.state.key.localeCompare(b.state.key)
}

/** 絞り込みの言葉に合うか。言葉がなければ合う */
export function matchesFilter(item: ShelfItem, filter: string): boolean {
  const terms = filter.toLowerCase().split(/\s+/).filter((t) => t !== '')
  if (terms.length === 0) return true
  const text = [item.ja, item.en, item.id, item.state.key].filter((v) => v !== null).join(' ').toLowerCase()
  return terms.every((t) => text.includes(t))
}

/**
 * 選択肢の中身（絞り込んだあと）。blueprintStates は設計図にあるブロック状態。
 * Mod は pack がなければ空。基本の部品は basic の順のまま（名前順にしない）
 */
export function shelfItems(
  tabId: string,
  pack: ShelfModpack | null,
  blueprintStates: readonly BlockState[],
  filter = '',
  basic: readonly BasicShelfBlock[] = [],
): ShelfItem[] {
  if (tabId === BASIC_TAB) {
    return basic
      .map((b) => ({ state: b.state, id: b.state.id.toString(), ja: b.name, en: null }))
      .filter((i) => matchesFilter(i, filter))
  }
  const name = (id: ResourceLocation, lang: 'ja_jp' | 'en_us') => pack?.displayName(id, lang) ?? null
  let items: ShelfItem[]
  if (tabId === BLUEPRINT_TAB) {
    items = blueprintStates.map((state) => ({ state, id: state.id.toString(), ja: name(state.id, 'ja_jp'), en: name(state.id, 'en_us') }))
  } else if (pack && tabId.startsWith('ns:')) {
    const ns = tabId.slice(3)
    items = pack
      .blockIds()
      .filter((id) => namespaceOf(id) === ns)
      .map((text) => {
        const id = ResourceLocation.parse(text)
        return { state: new BlockState(id, initialPropertiesFor(pack, id)), id: text, ja: name(id, 'ja_jp'), en: name(id, 'en_us') }
      })
  } else {
    items = []
  }
  return items.filter((i) => matchesFilter(i, filter)).sort(compareItems)
}
