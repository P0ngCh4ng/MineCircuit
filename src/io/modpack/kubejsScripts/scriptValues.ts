// スクリプトの中の物の書き方（`"3x minecraft:stone"`、`Item.of(…).withChance(…)` など）を、レシピのデータに直す。
// docs/create-throughput.md「KubeJS のスクリプトのレシピ」。

import type { RecipeResult } from '../recipes'
import { isSvalInternalName } from './svalNames'

/**
 * 作り物の `Item.of` などが返す値。スクリプトからは `.withChance(c)` などで変える。
 * 知らない項目（`.ignoreNBT()`・`.or(…)` など）は、自分を返す関数にする（そこでファイルが止まらないように）
 */
export class ScriptItem {
  constructor(
    /** アイテムの ID か、`#` 付きのタグ */
    readonly id: string,
    readonly count: number = 1,
    readonly chance: number = 1,
  ) {
    return new Proxy(this, {
      get: (target, key, receiver) => {
        if (typeof key === 'symbol' || key in target || key === 'then' || isSvalInternalName(key)) return Reflect.get(target, key, receiver) as unknown
        return () => receiver
      },
    })
  }

  withChance(chance: unknown): ScriptItem {
    return new ScriptItem(this.id, this.count, typeof chance === 'number' && Number.isFinite(chance) ? Math.min(Math.max(chance, 0), 1) : 1)
  }

  withCount(count: unknown): ScriptItem {
    return new ScriptItem(this.id, positiveInt(count) ?? 1, this.chance)
  }

  /** 1.18 の KubeJS の別名 */
  withNBT(): ScriptItem {
    return this
  }

  withName(): ScriptItem {
    return this
  }

  getId(): string {
    return this.id
  }

  getCount(): number {
    return this.count
  }

  getChance(): number {
    return this.chance
  }

  /** `Ingredient.of(…).test(item)`。ID か、同じタグかだけを見る */
  test(other: unknown): boolean {
    return toScriptItems(other).some((o) => o.id === this.id)
  }

  toJson(): unknown {
    return toPlainJson(this)
  }

  toString(): string {
    return this.count === 1 ? this.id : `${this.count}x ${this.id}`
  }
}

/** 液体。レシピのデータには入れない */
export class ScriptFluid {
  constructor(readonly id: string) {}

  withChance(): ScriptFluid {
    return this
  }
}

function positiveInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : null
}

/** namespace のない ID に `minecraft:` を付ける（タグの `#` は残す） */
export function withNamespace(id: string): string {
  const tag = id.startsWith('#')
  const name = (tag ? id.slice(1) : id).trim()
  const full = name.includes(':') ? name : `minecraft:${name}`
  return tag ? `#${full}` : full
}

/** `"3x minecraft:stone"` → ScriptItem。読めなければ null */
export function parseItemString(text: string): ScriptItem | null {
  const t = text.trim()
  if (t === '' || t === 'minecraft:air' || t === 'air') return null
  const m = /^(\d+)\s*x\s+(.+)$/i.exec(t)
  if (m) return new ScriptItem(withNamespace(m[2]), Math.max(1, Number.parseInt(m[1], 10)))
  return new ScriptItem(withNamespace(t))
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * スクリプトの値を物の一覧に直す。配列は平らにする。液体と読めないものは除く。
 * `{ item, count, chance }`・`{ tag }`・`{ id }`・文字列・ScriptItem を受け付ける
 */
export function toScriptItems(value: unknown): ScriptItem[] {
  if (Array.isArray(value)) return value.flatMap(toScriptItems)
  if (value instanceof ScriptItem) return [value]
  if (value instanceof ScriptFluid) return []
  if (typeof value === 'string') {
    const item = parseItemString(value)
    return item ? [item] : []
  }
  if (!isObject(value) || 'fluid' in value || 'fluidTag' in value || 'amount' in value) return []
  const count = positiveInt(value.count) ?? 1
  const chance = typeof value.chance === 'number' && Number.isFinite(value.chance) ? Math.min(Math.max(value.chance, 0), 1) : 1
  if (typeof value.item === 'string') return [new ScriptItem(withNamespace(value.item), count, chance)]
  if (typeof value.tag === 'string') return [new ScriptItem(`#${withNamespace(value.tag)}`, count, chance)]
  if (typeof value.id === 'string') return [new ScriptItem(withNamespace(value.id), count, chance)]
  // NeoForge のいずれかの材料（`{ type: 'neoforge:compound', ingredients }`）
  if (Array.isArray(value.ingredients)) return toScriptItems(value.ingredients)
  return []
}

/** 材料に直す。アイテムの ID とタグ（`#` なし）に分ける */
export function toIngredients(value: unknown): { items: string[]; tags: string[] } {
  const items = new Set<string>()
  const tags = new Set<string>()
  for (const s of toScriptItems(value)) {
    if (s.id.startsWith('#')) tags.add(s.id.slice(1))
    else items.add(s.id)
  }
  return { items: [...items], tags: [...tags] }
}

/** できる物に直す。タグは除く */
export function toResults(value: unknown): RecipeResult[] {
  return toScriptItems(value)
    .filter((s) => !s.id.startsWith('#'))
    .map((s) => ({ item: s.id, count: s.count, chance: s.chance }))
}

/** 1つの物の ID（`#` 付きのタグも）。読めなければ null */
export function toSingleId(value: unknown): string | null {
  return toScriptItems(value)[0]?.id ?? null
}

/** スクリプトの値を JSON にできる素のデータにする（`event.custom` の中の ScriptItem など） */
export function toPlainJson(value: unknown, depth = 0): unknown {
  if (depth > 32) return null
  if (value instanceof ScriptItem) return value.id.startsWith('#') ? { tag: value.id.slice(1) } : { item: value.id, count: value.count, chance: value.chance }
  if (value instanceof ScriptFluid) return { fluid: value.id, amount: 0 }
  if (Array.isArray(value)) return value.map((v) => toPlainJson(v, depth + 1))
  if (isObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = toPlainJson(v, depth + 1)
    return out
  }
  if (typeof value === 'function' || typeof value === 'symbol') return null
  return value
}
