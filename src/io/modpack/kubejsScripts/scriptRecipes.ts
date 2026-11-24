// スクリプトのレシピの関数で使う部品（Mod ごとの読み方の script から使う。recipes/<mod>Recipes.ts）。

import { toPlainJson, toScriptItems } from './scriptValues'

/** スクリプトの材料1つ分を、レシピ JSON の材料（ID と `#` 付きのタグの配列）にする */
function ingredientJson(value: unknown): string[] {
  return toScriptItems(value).map((s) => s.id)
}

/**
 * 作業台の形のレシピの呼び出し（`event.shaped(出る物, パターン, キー)`・`event.shapeless(出る物, 材料)` など）を、
 * レシピ JSON（`result`・`ingredients` か `pattern`・`key`）にする（#235）
 */
export function craftingJsonFromScript(
  typeId: string,
  shapeless: boolean,
  output: unknown,
  inputs: unknown,
  key: unknown,
): Record<string, unknown> {
  const result = toScriptItems(output).find((s) => !s.id.startsWith('#'))
  const json: Record<string, unknown> = { type: typeId, result: result ? { item: result.id, count: result.count } : null }
  if (shapeless) {
    // 1つの要素が1マス（`2x minecraft:stick` は2マス、配列はそのどれか）
    const slots: string[][] = []
    for (const v of Array.isArray(inputs) ? inputs : [inputs]) {
      if (Array.isArray(v)) {
        slots.push(ingredientJson(v))
        continue
      }
      for (const s of toScriptItems(v)) for (let i = 0; i < s.count; i++) slots.push([s.id])
    }
    json.ingredients = slots
  } else {
    json.pattern = toPlainJson(inputs)
    const keys: Record<string, string[]> = {}
    if (typeof key === 'object' && key !== null) for (const [k, v] of Object.entries(key)) keys[k] = ingredientJson(v)
    json.key = keys
  }
  return json
}

/** `mechanicalCrafting` → `mechanical_crafting` */
export function snakeCase(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
}
