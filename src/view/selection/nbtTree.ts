// 生データ（RawNbt）を、画面のツリーに出す形に変える。
// 値ごとにタグ型を残し、byte の 1 と int の 1 を見分けられるようにする。

import type { NbtTag, NbtTagType } from '../../domain/nbt'

/** ツリーの1行 */
export interface NbtTreeNode {
  /** Compound の項目名、またはリストの位置（"[0]"）。一番上は空文字 */
  readonly label: string
  readonly type: NbtTagType
  /** 型の名前（"int"、"list<compound>" など） */
  readonly typeLabel: string
  /** 値の文字列。Compound とリストは要素の数（"3 項目"） */
  readonly text: string
  /** Compound とリストの中身。それ以外は null */
  readonly children: readonly NbtTreeNode[] | null
}

/** 配列（byteArray など）の値を何個まで並べるか。多いときは残りの数だけ書く */
export const ARRAY_PREVIEW_LIMIT = 64

/** タグを1つ、ツリーの行に変える */
export function nbtTreeNode(label: string, tag: NbtTag): NbtTreeNode {
  switch (tag.type) {
    case 'compound':
      return {
        label,
        type: tag.type,
        typeLabel: 'compound',
        text: `${tag.value.size} 項目`,
        children: [...tag.value].map(([k, v]) => nbtTreeNode(k, v)),
      }
    case 'list':
      return {
        label,
        type: tag.type,
        typeLabel: `list<${tag.elementType}>`,
        text: `${tag.value.length} 個`,
        children: tag.value.map((v, i) => nbtTreeNode(`[${i}]`, v)),
      }
    default:
      return { label, type: tag.type, typeLabel: tag.type, text: nbtValueText(tag), children: null }
  }
}

/** Compound とリスト以外の値を文字列にする。SNBT と同じく型が分かる接尾辞を付ける */
export function nbtValueText(tag: NbtTag): string {
  switch (tag.type) {
    case 'byte':
      return `${tag.value}b`
    case 'short':
      return `${tag.value}s`
    case 'int':
      return String(tag.value)
    case 'long':
      return `${tag.value}L`
    case 'float':
      return `${floatText(tag.value)}f`
    case 'double':
      return `${tag.value}d`
    case 'string':
      return JSON.stringify(tag.value)
    case 'byteArray':
      return arrayText('B', Array.from(tag.value, (v) => `${v}b`))
    case 'intArray':
      return arrayText('I', Array.from(tag.value, (v) => String(v)))
    case 'longArray':
      return arrayText('L', Array.from(tag.value, (v) => `${v}L`))
    case 'compound':
      return `${tag.value.size} 項目`
    case 'list':
      return `${tag.value.length} 個`
  }
}

/**
 * float は 32bit で読んでいるので、そのまま出すと 0.10000000149011612 のようになる。
 * 32bit に丸めて同じ値に戻る、いちばん短い書き方にする。
 */
function floatText(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  for (let digits = 1; digits <= 9; digits++) {
    const short = Number(value.toPrecision(digits))
    if (Math.fround(short) === value) return String(short)
  }
  return String(value)
}

function arrayText(prefix: string, items: readonly string[]): string {
  const shown = items.slice(0, ARRAY_PREVIEW_LIMIT).join(', ')
  const rest = items.length - ARRAY_PREVIEW_LIMIT
  return rest > 0 ? `[${prefix}; ${shown}, …ほか ${rest} 個]` : `[${prefix}; ${shown}]`
}
