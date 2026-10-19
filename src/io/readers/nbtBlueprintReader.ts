// 構造物 NBT（.nbt）を Blueprint に読み込む。
// バニラの構造ブロックと Create の設計図が使う形式。リージョンは常に1つ（"main"、offset [0, 0, 0]）。
//
// 一番上の階層:
//   size        [x, y, z]（Int のリスト）
//   palette     状態のリスト（Name と Properties）。または
//   palettes    パレットのリスト。先頭を使い、残りは BlockVolume.alternatePalettes に残す
//   blocks      pos（[x, y, z]）・state（パレット番号）・nbt（ブロックエンティティ、ないこともある）
//   entities    エンティティ。要素をそのまま BlockVolume.entities に入れる
//   DataVersion Minecraft のデータの版。ないときは UNKNOWN_DATA_VERSION
// それ以外の項目（Mod が足した項目など）は BlockVolume.extra にそのまま入れる。

import { BlockState } from '../../domain/blockState'
import { BlockVolume, EMPTY_INDEX, cellIndex, type RawEntity } from '../../domain/blockVolume'
import { Blueprint } from '../../domain/blueprint'
import type { NbtCompound, NbtList, NbtTag, RawNbt } from '../../domain/nbt'
import { ResourceLocation } from '../../domain/resourceLocation'
import type { Vec3 } from '../../domain/vec3'
import { NbtParseError, parseNbtFile } from '../nbt/index'
import { BlueprintReadError, toBytes, type BlueprintReader } from './blueprintReader'

/** ファイルに DataVersion がないときの Blueprint.dataVersion。書き出しでは DataVersion を書かない */
export const UNKNOWN_DATA_VERSION = 0

/** .nbt のリージョン名 */
export const NBT_REGION_NAME = 'main'

/**
 * 空気として扱うブロックの ID。blocks にあっても置かれていないもの（空き、-1）にする。
 * パレットには残すので、パレット番号はファイルと同じになる。
 */
export const AIR_IDS: ReadonlySet<string> = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'])

/** 状態が空気なら true */
export function isAir(state: BlockState): boolean {
  return AIR_IDS.has(state.id.toString())
}

/** 一番上の階層で、この読み込みが解釈する項目。これ以外は extra に入れる */
const KNOWN_KEYS: ReadonlySet<string> = new Set(['size', 'palette', 'palettes', 'blocks', 'entities', 'DataVersion'])

/** 大きさの上限（セルの数）。これを超えるファイルは壊れているとみなす */
const MAX_CELLS = 256 * 256 * 256

export class NbtBlueprintReader implements BlueprintReader {
  canRead(fileName: string): boolean {
    return fileName.toLowerCase().endsWith('.nbt')
  }

  async read(name: string, data: ArrayBuffer | Uint8Array): Promise<Blueprint> {
    let root: NbtCompound
    try {
      root = (await parseNbtFile(toBytes(data))).root
    } catch (e) {
      if (e instanceof NbtParseError) {
        throw new BlueprintReadError(`"${name}" を NBT として読めませんでした。${e.message}`)
      }
      throw e
    }
    return structureToBlueprint(name, root)
  }
}

/**
 * 構造物 NBT の一番上の Compound から Blueprint を作る。
 * 形式が違うときは、何が足りないかを書いた BlueprintReadError を投げる。
 */
export function structureToBlueprint(name: string, root: NbtCompound): Blueprint {
  const fail: Fail = (what) => {
    throw new BlueprintReadError(`"${name}" は構造物 NBT（.nbt）の設計図として読めません。${what}`)
  }

  const size = readSize(root.value.get('size'), fail)
  const { palette, alternates } = readPalettes(root, fail)
  const cells = new Int32Array(size[0] * size[1] * size[2]).fill(EMPTY_INDEX)
  const blockEntities = new Map<number, RawNbt>()

  const blocksTag = root.value.get('blocks')
  if (blocksTag === undefined) fail('blocks（ブロックの一覧）がありません。')
  const blocks = expectList(blocksTag, 'compound', 'blocks', fail)
  blocks.forEach((tag, i) => {
    const block = tag as NbtCompound
    const where = `blocks の ${i} 番目`
    const pos = readIntTriple(block.value.get('pos'), `${where}の pos`, fail)
    const stateTag = block.value.get('state')
    if (stateTag === undefined) fail(`${where}に state（パレット番号）がありません。`)
    const stateIndex = intValue(stateTag, `${where}の state`, fail)
    if (stateIndex < 0 || stateIndex >= palette.length) {
      fail(`${where}の state ${stateIndex} がパレットにありません（パレットは ${palette.length} 個）。`)
    }
    const index = cellIndex(size, pos[0], pos[1], pos[2])
    if (index < 0) fail(`${where}の位置 [${pos.join(', ')}] が大きさ [${size.join(', ')}] の外です。`)

    // 同じ位置が2回出てきたら後のものを使う
    blockEntities.delete(index)
    if (isAir(palette[stateIndex])) {
      // 空気は置かれていないものとして扱う（設計書: cells の空気は -1）
      cells[index] = EMPTY_INDEX
      return
    }
    cells[index] = stateIndex
    const nbtTag = block.value.get('nbt')
    if (nbtTag !== undefined) {
      if (nbtTag.type !== 'compound') fail(`${where}の nbt が Compound ではありません。`)
      blockEntities.set(index, nbtTag as RawNbt)
    }
  })

  const entitiesTag = root.value.get('entities')
  const entities: RawEntity[] =
    entitiesTag === undefined ? [] : (expectList(entitiesTag, 'compound', 'entities', fail) as RawEntity[])

  const dataVersionTag = root.value.get('DataVersion')
  const dataVersion = dataVersionTag === undefined ? UNKNOWN_DATA_VERSION : intValue(dataVersionTag, 'DataVersion', fail)

  const extra: RawNbt = { type: 'compound', value: new Map() }
  for (const [key, value] of root.value) {
    if (!KNOWN_KEYS.has(key)) extra.value.set(key, value)
  }

  const region = new BlockVolume({
    name: NBT_REGION_NAME,
    size,
    palette,
    cells,
    blockEntities,
    entities,
    extra,
    alternatePalettes: alternates,
  })
  return new Blueprint(name, 'nbt', dataVersion, [region])
}

type Fail = (what: string) => never

function readSize(tag: NbtTag | undefined, fail: Fail): Vec3 {
  if (tag === undefined) fail('size（大きさ）がありません。')
  const size = readIntTriple(tag, 'size', fail)
  if (size.some((n) => n < 0)) fail(`size [${size.join(', ')}] に負の数があります。`)
  if (size[0] * size[1] * size[2] > MAX_CELLS) {
    fail(`size [${size.join(', ')}] が大きすぎます（${MAX_CELLS} マスまで）。`)
  }
  return size
}

/** palette か palettes を読む。palettes は先頭を使い、残りは生データのまま返す */
function readPalettes(root: NbtCompound, fail: Fail): { palette: BlockState[]; alternates: RawNbt[][] } {
  const paletteTag = root.value.get('palette')
  if (paletteTag !== undefined) {
    return { palette: readPalette(paletteTag, 'palette', fail), alternates: [] }
  }
  const palettesTag = root.value.get('palettes')
  if (palettesTag === undefined) fail('palette（ブロック状態の一覧）も palettes もありません。')
  const lists = expectList(palettesTag, 'list', 'palettes', fail)
  if (lists.length === 0) fail('palettes が空です。パレットが1つ以上必要です。')
  const palette = readPalette(lists[0], 'palettes の 0 番目', fail)
  const alternates = lists.slice(1).map((tag, i) => {
    const where = `palettes の ${i + 1} 番目`
    const entries = expectList(tag, 'compound', where, fail) as RawNbt[]
    // 中身を確かめるだけ。書き出しで戻すため、生データのまま持つ
    readPalette(tag, where, fail)
    return entries
  })
  return { palette, alternates }
}

function readPalette(tag: NbtTag, where: string, fail: Fail): BlockState[] {
  return expectList(tag, 'compound', where, fail).map((entry, i) => {
    const c = entry as NbtCompound
    const nameTag = c.value.get('Name')
    if (nameTag === undefined || nameTag.type !== 'string') fail(`${where}の ${i} 番目に Name（ブロックの ID）がありません。`)
    let id: ResourceLocation
    try {
      id = ResourceLocation.parse((nameTag as { value: string }).value)
    } catch (e) {
      return fail(`${where}の ${i} 番目: ${e instanceof Error ? e.message : String(e)}`)
    }
    const props: Record<string, string> = {}
    const propsTag = c.value.get('Properties')
    if (propsTag !== undefined) {
      if (propsTag.type !== 'compound') fail(`${where}の ${i} 番目の Properties が Compound ではありません。`)
      for (const [key, value] of (propsTag as NbtCompound).value) {
        if (value.type !== 'string') fail(`${where}の ${i} 番目の Properties の ${key} が文字列ではありません。`)
        props[key] = (value as { value: string }).value
      }
    }
    return new BlockState(id, props)
  })
}

/** 要素型が elementType のリストの要素を返す。空のリスト（要素型 end も含む）は空の配列 */
function expectList(tag: NbtTag, elementType: NbtList['elementType'], where: string, fail: Fail): NbtTag[] {
  if (tag.type !== 'list') fail(`${where} がリストではありません。`)
  const list = tag as NbtList
  if (list.value.length === 0) return []
  if (list.elementType !== elementType) fail(`${where} の要素の型が ${list.elementType} です（${elementType} のはずです）。`)
  return list.value
}

function readIntTriple(tag: NbtTag | undefined, where: string, fail: Fail): Vec3 {
  if (tag === undefined) return fail(`${where} がありません。`)
  if (tag.type === 'intArray' && tag.value.length === 3) return [tag.value[0], tag.value[1], tag.value[2]]
  if (tag.type !== 'list' || tag.value.length !== 3) fail(`${where} が3つの整数のリストではありません。`)
  const values = (tag as NbtList).value.map((v) => intValue(v, where, fail))
  return [values[0], values[1], values[2]]
}

function intValue(tag: NbtTag, where: string, fail: Fail): number {
  if (tag.type === 'int' || tag.type === 'short' || tag.type === 'byte') return tag.value
  return fail(`${where} が整数ではありません。`)
}
