// テスト用の設計図を作るヘルパー。
// 同じ内容から、Blueprint（読み込んだあとの形）と構造物 NBT（.nbt ファイルの形）の両方を作る。
// 2つは別々の道筋で作るので、読み込み（NBT → Blueprint）と書き出し（Blueprint → NBT）の
// テストで「期待する結果」として使える。他人の設計図は使わず、ここでコードから作る。

import { BlockState } from '../../src/domain/blockState'
import { BlockVolume, cellIndex, type RawEntity } from '../../src/domain/blockVolume'
import { Blueprint } from '../../src/domain/blueprint'
import { nbt, type NbtDocument, type NbtTag, type RawNbt } from '../../src/domain/nbt'
import { ResourceLocation } from '../../src/domain/resourceLocation'
import type { Vec3 } from '../../src/domain/vec3'
import { serializeNbtFile } from '../../src/io/nbt/index'

/** ブロック状態の書き方。"create:shaft[axis=y]" のような文字列か BlockState */
export type StateLike = string | BlockState

/** ブロック状態の properties */
export type StateProps = Readonly<Record<string, string>>

/** 1.18.2 の DataVersion。指定しないときに使う */
export const DEFAULT_DATA_VERSION = 2975

/**
 * "create:shaft[axis=y,waterlogged=false]" や "stone" を BlockState にする。
 * props を渡すと、文字列の中の properties に足す（同じ名前は props が優先）。
 */
export function state(s: StateLike, props: StateProps = {}): BlockState {
  if (s instanceof BlockState) {
    return Object.keys(props).length === 0 ? s : new BlockState(s.id, { ...s.properties, ...props })
  }
  const open = s.indexOf('[')
  if (open < 0) return new BlockState(ResourceLocation.parse(s.trim()), props)
  if (!s.endsWith(']')) throw new Error(`ブロック状態 "${s}" の [ ] が閉じていません。`)
  const parsed: Record<string, string> = {}
  const body = s.slice(open + 1, -1).trim()
  if (body !== '') {
    for (const pair of body.split(',')) {
      const eq = pair.indexOf('=')
      if (eq < 0) throw new Error(`ブロック状態 "${s}" の "${pair}" に = がありません。`)
      parsed[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
    }
  }
  return new BlockState(ResourceLocation.parse(s.slice(0, open).trim()), { ...parsed, ...props })
}

/** layers() の凡例の値。状態だけか、状態と生データ */
export type LegendEntry = StateLike | { state: StateLike; props?: StateProps; nbt?: RawNbt }

/** 1つの段。z の順に並べた行（各文字が x）。複数行の文字列1つでもよい */
export type LayerRows = readonly string[] | string

/** 構造物 NBT を作るときの選び方 */
export interface NbtOptions {
  /**
   * パレットの書き方。`palette`（ふつう）か `palettes`（パレットのリスト。先頭が使われる）。
   * 既定は `palette`。
   */
  paletteForm?: 'palette' | 'palettes'
  /**
   * `palettes` 形式のとき、先頭のパレットの後ろに足すパレット。
   * それぞれ先頭のパレットと同じ数の状態にすること。読み込みが先頭だけを使うかを確かめるのに使う。
   */
  alternatePalettes?: readonly (readonly StateLike[])[]
  /** DataVersion を書かない（古いファイルや、DataVersion がないファイルの再現） */
  omitDataVersion?: boolean
  /** entities を書かない（空のリストも書かない） */
  omitEntities?: boolean
}

interface FixtureBlock {
  state: BlockState
  nbt: RawNbt | null
}

/**
 * テスト用の設計図（.nbt、リージョン1つ）を組み立てる。
 *
 * ```ts
 * const fx = blueprintFixture({ size: [3, 2, 3] })
 *   .place([0, 0, 0], 'create:shaft', { axis: 'y' })
 *   .place([1, 0, 0], 'create:creative_motor[facing=up]', nbt.compound({ Speed: nbt.int(64) }))
 *   .fill([0, 1, 0], [2, 1, 2], 'minecraft:stone')
 *   .extra('Railways_DataVersion', nbt.int(2))
 * fx.toBlueprint()              // Blueprint
 * fx.toNbtDocument()            // NbtDocument（構造物 NBT）
 * await fx.toNbtBytes()         // gzip 済みの .nbt のバイト列
 * ```
 *
 * size を省略すると、置いたブロックが全部入る一番小さい大きさになる。
 * パレットは、ブロックを最初に置いた順（と paletteState() で足した順）に並ぶ。
 * 同じ位置に置き直すと、前のブロックと生データは消える。
 */
export class BlueprintFixture {
  private readonly blocks = new Map<string, { pos: Vec3; block: FixtureBlock }>()
  private readonly paletteOrder: BlockState[] = []
  private readonly entityList: RawEntity[] = []
  private readonly extraEntries: [string, NbtTag][] = []
  private fixedSize: Vec3 | null
  private fileName: string
  private dataVersionValue: number

  constructor(options: { size?: Vec3; name?: string; dataVersion?: number } = {}) {
    this.fixedSize = options.size ?? null
    this.fileName = options.name ?? 'fixture.nbt'
    this.dataVersionValue = options.dataVersion ?? DEFAULT_DATA_VERSION
  }

  /** 大きさを決める。置いたブロックが入らなければ、作るときにエラーになる */
  size(size: Vec3): this {
    this.fixedSize = size
    return this
  }

  /** ファイル名（Blueprint.name）を決める */
  name(name: string): this {
    this.fileName = name
    return this
  }

  dataVersion(dataVersion: number): this {
    this.dataVersionValue = dataVersion
    return this
  }

  /**
   * pos にブロックを置く。
   * 3つ目の引数は properties か生データ。両方渡すときは place(pos, id, props, nbt)。
   */
  place(pos: Vec3, s: StateLike, propsOrNbt?: StateProps | RawNbt, blockNbt?: RawNbt): this {
    let props: StateProps = {}
    let raw: RawNbt | null = blockNbt ?? null
    if (propsOrNbt !== undefined) {
      if (isRawNbt(propsOrNbt)) raw = propsOrNbt
      else props = propsOrNbt
    }
    checkPos(pos)
    const st = state(s, props)
    this.paletteState(st)
    this.blocks.set(pos.join(','), { pos: [pos[0], pos[1], pos[2]], block: { state: st, nbt: raw } })
    return this
  }

  /** from から to まで（両端を含む直方体）を同じブロックで埋める。生データは付けない */
  fill(from: Vec3, to: Vec3, s: StateLike, props: StateProps = {}): this {
    const st = state(s, props)
    const lo = [0, 1, 2].map((a) => Math.min(from[a], to[a]))
    const hi = [0, 1, 2].map((a) => Math.max(from[a], to[a]))
    for (let y = lo[1]; y <= hi[1]; y++) {
      for (let z = lo[2]; z <= hi[2]; z++) {
        for (let x = lo[0]; x <= hi[0]; x++) this.place([x, y, z], st)
      }
    }
    return this
  }

  /**
   * 文字で描いた段を置く。layers[y] が段 y、その中の行が z、行の中の文字が x。
   * `.` と空白は空き。それ以外の文字は legend で引く（ない文字はエラー）。
   *
   * ```ts
   * fx.layers([
   *   ['CSC',
   *    '...'],
   *   ['.M.'],
   * ], { C: 'create:cogwheel[axis=y]', S: 'create:shaft[axis=x]', M: { state: 'create:creative_motor', nbt } })
   * ```
   */
  layers(layers: readonly LayerRows[], legend: Readonly<Record<string, LegendEntry>>, origin: Vec3 = [0, 0, 0]): this {
    layers.forEach((layer, y) => {
      const rows = typeof layer === 'string' ? splitRows(layer) : layer
      rows.forEach((row, z) => {
        ;[...row].forEach((ch, x) => {
          if (ch === '.' || ch === ' ') return
          const entry = legend[ch]
          if (entry === undefined) throw new Error(`layers の文字 "${ch}" が凡例にありません。`)
          const pos: Vec3 = [origin[0] + x, origin[1] + y, origin[2] + z]
          if (typeof entry === 'string' || entry instanceof BlockState) this.place(pos, entry)
          else this.place(pos, entry.state, entry.props ?? {}, entry.nbt)
        })
      })
    })
    return this
  }

  /** pos のブロックを取り除く（空きにする）。パレットには残る */
  remove(pos: Vec3): this {
    this.blocks.delete(pos.join(','))
    return this
  }

  /**
   * パレットに状態を足す。ブロックを置かなくても足せるので、
   * 「パレットにあるが使われていない状態」を作るのに使う。すでにあれば何もしない。
   */
  paletteState(s: StateLike, props: StateProps = {}): this {
    const st = state(s, props)
    if (!this.paletteOrder.some((p) => p.equals(st))) this.paletteOrder.push(st)
    return this
  }

  /** エンティティを足す。entityNbt() で作るか、生データをそのまま渡す */
  entity(raw: RawEntity): this {
    this.entityList.push(raw)
    return this
  }

  /** 一番上の階層に、知らない項目（Mod が足した項目など）を足す */
  extra(key: string, value: NbtTag): this {
    if (KNOWN_KEYS.has(key)) throw new Error(`"${key}" は構造物 NBT の決まった項目なので extra には使えません。`)
    this.extraEntries.push([key, value])
    return this
  }

  /** 大きさ。省略していれば、置いたブロックから決める */
  get resolvedSize(): Vec3 {
    if (this.fixedSize) return this.fixedSize
    const max = [0, 0, 0]
    for (const { pos } of this.blocks.values()) for (let a = 0; a < 3; a++) max[a] = Math.max(max[a], pos[a] + 1)
    return [max[0], max[1], max[2]]
  }

  /** パレット（置いた順） */
  get palette(): readonly BlockState[] {
    return this.paletteOrder
  }

  /** 置いたブロックの数 */
  get blockCount(): number {
    return this.blocks.size
  }

  /** 置いたブロックを cellIndex() の順（y、z、x）で返す */
  sortedBlocks(): { pos: Vec3; state: BlockState; nbt: RawNbt | null }[] {
    const size = this.resolvedSize
    const list = [...this.blocks.values()].map(({ pos, block }) => {
      const index = cellIndex(size, pos[0], pos[1], pos[2])
      if (index < 0) {
        throw new Error(`位置 [${pos.join(', ')}] が大きさ [${size.join(', ')}] の外です。size を大きくしてください。`)
      }
      return { index, pos, state: block.state, nbt: block.nbt }
    })
    list.sort((a, b) => a.index - b.index)
    return list.map(({ pos, state: st, nbt: raw }) => ({ pos, state: st, nbt: raw }))
  }

  /**
   * 読み込んだあとの形の Blueprint を作る。毎回新しく作るので、編集のテストで書き換えてよい。
   * 生データは写して入れるので、元のヘルパーや他の Blueprint には影響しない。
   *
   * - リージョンは1つで、名前は "main"、offset は [0, 0, 0]
   * - BlockVolume.extra には、extra() で足した知らない項目だけが入る
   *   （size・palette・palettes・blocks・entities・DataVersion は入れない）
   * - エンティティは構造物 NBT の entities の要素（pos・blockPos・nbt を持つ Compound）をそのまま入れる
   */
  toBlueprint(): Blueprint {
    const size = this.resolvedSize
    const palette = [...this.paletteOrder]
    const cells = new Int32Array(size[0] * size[1] * size[2]).fill(-1)
    const blockEntities = new Map<number, RawNbt>()
    for (const b of this.sortedBlocks()) {
      const i = cellIndex(size, b.pos[0], b.pos[1], b.pos[2])
      cells[i] = palette.findIndex((p) => p.equals(b.state))
      if (b.nbt) blockEntities.set(i, cloneNbt(b.nbt))
    }
    const region = new BlockVolume({
      name: 'main',
      size,
      palette,
      cells,
      blockEntities,
      entities: this.entityList.map(cloneNbt),
      extra: nbt.compound(this.extraEntries.map(([k, v]) => [k, cloneTag(v)] as const)),
    })
    return new Blueprint(this.fileName, 'nbt', this.dataVersionValue, [region])
  }

  /**
   * 構造物 NBT（.nbt の中身）を作る。項目の並びはバニラと同じ
   * （size、entities、blocks、palette、DataVersion）で、extra() の項目はその後ろ。
   * blocks は cellIndex() の順。空きは blocks に書かない。properties がない状態は Properties を書かない。
   */
  toNbtDocument(options: NbtOptions = {}): NbtDocument {
    const size = this.resolvedSize
    const palette = this.paletteOrder
    const blocks = this.sortedBlocks().map((b) => {
      const entries: [string, NbtTag][] = [
        ['pos', nbt.list('int', b.pos.map((n) => nbt.int(n)))],
        ['state', nbt.int(palette.findIndex((p) => p.equals(b.state)))],
      ]
      if (b.nbt) entries.push(['nbt', cloneNbt(b.nbt)])
      return nbt.compound(entries)
    })

    const root: [string, NbtTag][] = [['size', nbt.list('int', size.map((n) => nbt.int(n)))]]
    if (!options.omitEntities) {
      root.push(['entities', nbt.list(this.entityList.length ? 'compound' : 'end', this.entityList.map(cloneNbt))])
    }
    root.push(['blocks', nbt.list(blocks.length ? 'compound' : 'end', blocks)])

    const paletteTag = paletteList(palette)
    if ((options.paletteForm ?? 'palette') === 'palettes') {
      const alternates = (options.alternatePalettes ?? []).map((alt) => {
        if (alt.length !== palette.length) {
          throw new Error(`alternatePalettes の状態の数 ${alt.length} がパレットの数 ${palette.length} と違います。`)
        }
        return paletteList(alt.map((s) => state(s)))
      })
      root.push(['palettes', nbt.list('list', [paletteTag, ...alternates])])
    } else {
      if (options.alternatePalettes?.length) throw new Error('alternatePalettes は paletteForm: "palettes" のときだけ使えます。')
      root.push(['palette', paletteTag])
    }
    if (!options.omitDataVersion) root.push(['DataVersion', nbt.int(this.dataVersionValue)])
    for (const [k, v] of this.extraEntries) root.push([k, cloneTag(v)])
    return { name: '', root: nbt.compound(root) }
  }

  /** .nbt ファイルのバイト列を作る。既定は gzip で圧縮する（実際の .nbt と同じ） */
  async toNbtBytes(options: NbtOptions & { compress?: boolean } = {}): Promise<Uint8Array> {
    return serializeNbtFile(this.toNbtDocument(options), { compress: options.compress })
  }
}

/** BlueprintFixture を作る。`blueprintFixture({ size: [3, 1, 3] }).place(...)` */
export function blueprintFixture(options: { size?: Vec3; name?: string; dataVersion?: number } = {}): BlueprintFixture {
  return new BlueprintFixture(options)
}

/**
 * 構造物 NBT の entities の要素を作る。pos（double）と blockPos（int）は同じ位置から作る。
 * extraNbt はエンティティ自身の nbt（id の後ろ）に足す。
 */
export function entityNbt(pos: Vec3, id: string, extraNbt: RawNbt = nbt.compound()): RawEntity {
  const inner = nbt.compound([['id', nbt.string(id)] as const, ...[...extraNbt.value].filter(([k]) => k !== 'id')])
  return nbt.compound({
    pos: nbt.list('double', pos.map((n) => nbt.double(n + 0.5))),
    blockPos: nbt.list('int', pos.map((n) => nbt.int(Math.floor(n)))),
    nbt: inner,
  })
}

/**
 * Blueprint の中身を、toEqual で比べやすい形にする。
 * パレットの並びや、使われていないパレットの状態には左右されない。
 * 読み込み → 書き出し → 読み込みで、配置・状態・生データ・知らない項目が一致するかを確かめるのに使う。
 */
export function blueprintContents(bp: Blueprint) {
  return {
    format: bp.format,
    dataVersion: bp.dataVersion,
    regions: bp.regions.map((r) => {
      const blocks: { pos: Vec3; state: string; nbt: RawNbt | null }[] = []
      r.forEachBlock((x, y, z, st, raw) => blocks.push({ pos: [x, y, z], state: st.key, nbt: raw }))
      return { name: r.name, offset: r.offset, size: r.size, blocks, entities: r.entities, extra: r.extra }
    }),
  }
}

/** NBT の値を深く写す */
export function cloneTag<T extends NbtTag>(tag: T): T {
  return cloneAny(tag) as T
}

/** 生データ（Compound）を深く写す */
export function cloneNbt(raw: RawNbt): RawNbt {
  return cloneTag(raw)
}

function cloneAny(tag: NbtTag): NbtTag {
  switch (tag.type) {
    case 'compound':
      return { type: 'compound', value: new Map([...tag.value].map(([k, v]) => [k, cloneAny(v)])) }
    case 'list':
      return { type: 'list', elementType: tag.elementType, value: tag.value.map(cloneAny) }
    case 'byteArray':
      return { type: 'byteArray', value: tag.value.slice() }
    case 'intArray':
      return { type: 'intArray', value: tag.value.slice() }
    case 'longArray':
      return { type: 'longArray', value: tag.value.slice() }
    default:
      return { ...tag }
  }
}

const KNOWN_KEYS = new Set(['size', 'palette', 'palettes', 'blocks', 'entities', 'DataVersion'])

function paletteList(states: readonly BlockState[]): NbtTag {
  return nbt.list(
    states.length ? 'compound' : 'end',
    states.map((st) => {
      const entries: [string, NbtTag][] = [['Name', nbt.string(st.id.toString())]]
      const names = Object.keys(st.properties)
      if (names.length) entries.push(['Properties', nbt.compound(names.map((n) => [n, nbt.string(st.properties[n])] as const))])
      return nbt.compound(entries)
    }),
  )
}

function isRawNbt(v: StateProps | RawNbt): v is RawNbt {
  return v.type === 'compound' && (v as { value?: unknown }).value instanceof Map
}

function checkPos(pos: Vec3): void {
  if (!pos.every((n) => Number.isInteger(n) && n >= 0)) {
    throw new Error(`位置 [${pos.join(', ')}] が正しくありません。0 以上の整数を指定してください。`)
  }
}

/** 複数行の文字列を行に分ける。前後の空行と、共通の字下げを取り除く */
function splitRows(text: string): string[] {
  const lines = text.split('\n')
  while (lines.length && lines[0].trim() === '') lines.shift()
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  const indent = Math.min(...lines.filter((l) => l.trim() !== '').map((l) => l.length - l.trimStart().length))
  return lines.map((l) => l.slice(indent).trimEnd())
}
