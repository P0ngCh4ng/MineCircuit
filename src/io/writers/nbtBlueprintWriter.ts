// Blueprint を構造物 NBT（.nbt）に書き出す。NbtBlueprintReader の逆。
//
// 一番上の階層は次の順に書く（バニラの構造ブロックと同じ並び）:
//   size        リージョンの大きさ
//   entities    BlockVolume.entities をそのまま
//   blocks      置かれているブロック。pos・state（パレット番号）・nbt（生データがあれば）
//   palette     使っている状態だけで作り直したパレット。
//   palettes    （読み込んだファイルが palettes 形式だったとき palette の代わりに）先頭は作り直したパレット、
//               2つ目以降は BlockVolume.alternatePalettes から同じ状態の項目を取り出したもの
//   DataVersion Blueprint.dataVersion。UNKNOWN_DATA_VERSION（0）なら書かない
//   その後ろ    BlockVolume.extra の項目（Mod が足した項目など）をそのまま

import type { BlockState } from '../../domain/blockState'
import type { BlockVolume } from '../../domain/blockVolume'
import type { Blueprint } from '../../domain/blueprint'
import { nbt, type NbtCompound, type NbtTag, type RawNbt } from '../../domain/nbt'
import { serializeNbtFile } from '../nbt/index'
import { UNKNOWN_DATA_VERSION } from '../readers/nbtBlueprintReader'
import { BlueprintWriteError, type BlueprintWriter } from './blueprintWriter'

/** 形式で決まった一番上の項目。extra に同じ名前があっても、こちらを書く */
const STRUCTURE_KEYS: ReadonlySet<string> = new Set(['size', 'palette', 'palettes', 'blocks', 'entities', 'DataVersion'])

export class NbtBlueprintWriter implements BlueprintWriter {
  readonly format = 'nbt' as const
  readonly extension = '.nbt'

  async write(bp: Blueprint): Promise<Uint8Array> {
    return serializeNbtFile({ name: '', root: blueprintToStructure(bp) })
  }
}

/**
 * Blueprint から構造物 NBT の一番上の Compound を作る。
 * .nbt はリージョンを1つしか持てないので、リージョンが1つでなければ BlueprintWriteError を投げる。
 * 生データ（ブロックエンティティ・エンティティ・extra）は写さずに、同じ値をそのまま入れる。
 */
export function blueprintToStructure(bp: Blueprint): NbtCompound {
  if (bp.regions.length !== 1) {
    throw new BlueprintWriteError(
      `"${bp.name}" はリージョンが ${bp.regions.length} 個あるので、.nbt に書き出せません。.nbt に書けるのはリージョン1つだけです。`,
    )
  }
  const region = bp.regions[0]
  const { usedIndices, newIndex } = usedPalette(region)

  const blocks: NbtCompound[] = []
  region.forEachBlock((x, y, z, state, blockEntity) => {
    const entries: [string, NbtTag][] = [
      ['pos', intList([x, y, z])],
      ['state', nbt.int(newIndex(state))],
    ]
    if (blockEntity) entries.push(['nbt', blockEntity])
    blocks.push(nbt.compound(entries))
  })

  const root = new Map<string, NbtTag>()
  root.set('size', intList(region.size))
  root.set('entities', listOf('compound', region.entities))
  root.set('blocks', listOf('compound', blocks))

  const palette = usedIndices.map((i) => paletteEntry(region.palette[i]))
  if (region.alternatePalettes.length === 0) {
    root.set('palette', listOf('compound', palette))
  } else {
    // 各パレットの i 番目は同じブロックの別の見た目。使っている番号の項目だけを取り出す。
    // 編集で足した状態（元のパレットより後ろの番号）は、別のパレットにも同じ状態を書く
    const alternates = region.alternatePalettes.map((alt) =>
      listOf(
        'compound',
        usedIndices.map((i) => (i < alt.length ? alt[i] : paletteEntry(region.palette[i]))),
      ),
    )
    root.set('palettes', listOf('list', [listOf('compound', palette), ...alternates]))
  }

  if (bp.dataVersion !== UNKNOWN_DATA_VERSION) root.set('DataVersion', nbt.int(bp.dataVersion))
  for (const [key, value] of region.extra.value) {
    if (!STRUCTURE_KEYS.has(key)) root.set(key, value)
  }
  return { type: 'compound', value: root }
}

/**
 * 置かれているブロックが使うパレット番号（元の番号の小さい順）と、状態 → 新しい番号の引き方。
 * 同じ状態がパレットに2つあるファイルでも、元の番号ごとに分けて残す。
 */
function usedPalette(region: BlockVolume): { usedIndices: number[]; newIndex: (state: BlockState) => number } {
  const palette = region.palette
  // forEachBlock はパレットの中のオブジェクトをそのまま渡すので、オブジェクトで元の番号を引ける
  const originalIndex = new Map<BlockState, number>()
  palette.forEach((state, i) => {
    if (!originalIndex.has(state)) originalIndex.set(state, i)
  })
  const indexOf = (state: BlockState): number => {
    const found = originalIndex.get(state) ?? palette.findIndex((p) => p.key === state.key)
    if (found < 0) throw new BlueprintWriteError(`ブロック状態 ${state.key} がパレットにありません。設計図が壊れています。`)
    return found
  }

  const used = new Set<number>()
  region.forEachBlock((_x, _y, _z, state) => used.add(indexOf(state)))
  const usedIndices = [...used].sort((a, b) => a - b)
  const renumber = new Map(usedIndices.map((original, i) => [original, i]))
  return { usedIndices, newIndex: (state) => renumber.get(indexOf(state)) as number }
}

/** パレットの1項目（Name と、properties があれば Properties） */
function paletteEntry(state: BlockState): RawNbt {
  const entries: [string, NbtTag][] = [['Name', nbt.string(state.id.toString())]]
  const names = Object.keys(state.properties)
  if (names.length > 0) {
    entries.push(['Properties', nbt.compound(names.map((name) => [name, nbt.string(state.properties[name])] as const))])
  }
  return nbt.compound(entries)
}

function intList(values: readonly number[]): NbtTag {
  return nbt.list('int', values.map((v) => nbt.int(v)))
}

/** 要素型 elementType のリスト。空のときはバニラと同じく要素型を end にする */
function listOf(elementType: 'compound' | 'list', values: readonly NbtTag[]): NbtTag {
  return nbt.list(values.length > 0 ? elementType : 'end', [...values])
}
