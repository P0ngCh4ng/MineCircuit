import type { NbtTagType } from '../../domain/nbt'

// ファイル上のタグ番号と型の名前の対応。番号は配列の位置
const TAG_TYPES: readonly NbtTagType[] = [
  'end',
  'byte',
  'short',
  'int',
  'long',
  'float',
  'double',
  'byteArray',
  'string',
  'list',
  'compound',
  'intArray',
  'longArray',
]

const TAG_IDS: ReadonlyMap<NbtTagType, number> = new Map(TAG_TYPES.map((t, i) => [t, i]))

export function tagTypeFromId(id: number): NbtTagType | null {
  return TAG_TYPES[id] ?? null
}

export function tagIdFromType(type: NbtTagType): number {
  const id = TAG_IDS.get(type)
  if (id === undefined) throw new Error(`不明なタグ型です: ${String(type)}`)
  return id
}
