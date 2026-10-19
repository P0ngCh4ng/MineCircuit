// 「置くブロック」の入力欄と一覧（#18）。入力した文字をブロック状態に直し、設計図にあるブロック状態を集める。

import { BlockState } from '../../domain/blockState'
import type { Blueprint } from '../../domain/blueprint'
import { ResourceLocation } from '../../domain/resourceLocation'
import { isAir } from '../../io/readers/nbtBlueprintReader'

/** 入力の形が正しくないとき。message はそのまま画面に出せる */
export class BrushInputError extends Error {}

/**
 * 入力した文字をブロック状態にする。形は "create:shaft" か "create:shaft[axis=y,waterlogged=false]"。
 * namespace を省くと minecraft。空なら null。形が正しくなければ BrushInputError。
 */
export function parseBlockStateInput(text: string): BlockState | null {
  const s = text.trim()
  if (s === '') return null
  const open = s.indexOf('[')
  const idText = (open < 0 ? s : s.slice(0, open)).trim()
  let id: ResourceLocation
  try {
    id = ResourceLocation.parse(idText)
  } catch (e) {
    throw new BrushInputError(e instanceof Error ? e.message : String(e))
  }
  if (/\s/.test(idText)) throw new BrushInputError(`ID "${idText}" に空白があります。"create:shaft" の形で入力してください。`)

  const properties: Record<string, string> = {}
  if (open >= 0) {
    if (!s.endsWith(']')) {
      throw new BrushInputError('"[" に対応する "]" がありません。"create:shaft[axis=y]" の形で入力してください。')
    }
    const body = s.slice(open + 1, -1).trim()
    for (const part of body === '' ? [] : body.split(',')) {
      const eq = part.indexOf('=')
      const name = (eq < 0 ? part : part.slice(0, eq)).trim()
      const value = eq < 0 ? '' : part.slice(eq + 1).trim()
      if (name === '' || value === '') {
        throw new BrushInputError(`"${part.trim()}" は "名前=値" の形ではありません。"axis=y" のように入力してください。`)
      }
      properties[name] = value
    }
  }
  return new BlockState(id, properties)
}

/**
 * 設計図にあるブロック状態（空気を除く）。各リージョンのパレットから、重なりを除いて key の順に並べる。
 * パレットには、編集で使われなくなった状態も残る。
 */
export function blueprintBlockStates(bp: Blueprint): BlockState[] {
  const found = new Map<string, BlockState>()
  for (const region of bp.regions) {
    for (const state of region.palette) {
      if (!isAir(state) && !found.has(state.key)) found.set(state.key, state)
    }
  }
  return [...found.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}
