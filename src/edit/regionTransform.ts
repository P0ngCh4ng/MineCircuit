// 範囲を動かす・回す・反転する操作（docs/design.md「範囲の編集」、#131・#132）。Blueprint は変えず、操作（EditCommand）だけを返す。
// 行き先が設計図の外なら設計図を広げる（負の向きなら全体をずらす）。エンティティも一緒に変換する。

import type { BlockState } from '../domain/blockState'
import type { Blueprint } from '../domain/blueprint'
import { EMPTY_CELL, type BlockVolume, type CellValue, type RawEntity } from '../domain/blockVolume'
import {
  inverseTransformPos,
  isPureTranslation,
  transformBox,
  transformDirection,
  transformPoint,
  transformPos,
  translation,
  type BlockTransform,
} from '../domain/blockTransform'
import { boxContains, forEachInBox, type Box } from '../domain/box'
import { DIRECTIONS, type Direction } from '../domain/direction'
import type { NbtTag, RawNbt } from '../domain/nbt'
import { addVec3, subVec3, type Vec3 } from '../domain/vec3'
import type { CellChange, EditCommand, EntityChange, RegionResize, Relocation } from './editCommand'
import { transformVanillaState, type StateTransformer } from './stateTransform'

/** 設計図の各辺の大きさの上限 */
export const MAX_BLUEPRINT_SIDE = 512

/** 範囲の操作の結果。作れたときは操作と、動いた先の範囲（操作のあとの座標） */
export type RegionEditResult =
  | { readonly ok: true; readonly command: EditCommand; readonly box: Box; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly reason: string }

/** 生データの中の座標を書き直した結果。unresolved は、直せない位置（範囲の外を指すものなど）が残ったとき */
export interface BlockEntityTransform {
  readonly nbt: RawNbt
  readonly unresolved: boolean
}

/**
 * 生データの中の座標を、ブロックの変換に合わせて書き直す関数（Mod ごとの規則。画面が計算プラグインから作る）。
 * state は変換の前の状態、from・to は変換の前と後のマス（設計図全体の座標）、source は変換する範囲（変換の前の座標）。
 * 知らないブロックなら null（そのまま）
 */
export type BlockEntityTransformer = (
  state: BlockState,
  nbt: RawNbt,
  t: BlockTransform,
  from: Vec3,
  to: Vec3,
  source: Box,
) => BlockEntityTransform | null

export interface TransformOptions {
  /** 行き先にある範囲の外のブロックを上書きするか */
  readonly overwrite: boolean
  /** ブロック状態の向きを変える。省略ならバニラの規則（transformVanillaState） */
  readonly states?: StateTransformer
  /** 生データの中の座標を書き直す。省略なら生データはそのまま */
  readonly blockEntity?: BlockEntityTransformer
}

/** 断る理由と知らせ（そのまま状態表示に出す） */
export const MOVE_MESSAGES = {
  outside: '範囲が設計図の外にあります。設計図の中を選んでください',
  acrossRegions: '範囲が2つ以上のリージョンにまたがっています。1つのリージョンの中を選んでください',
  tooLarge: `設計図が各辺 ${MAX_BLUEPRINT_SIDE} を超えるので動かせません`,
  overlapsRegion: '動かす先がほかのリージョンに重なるので動かせません',
  blocked: (count: number) => `動かす先にブロックがあります（${count} 個）。Ctrl を押しながら動かすと上書きします`,
  unresolvedBlockEntity: (count: number) => `生データの座標を直せないブロックがあります（${count} 個）`,
} as const

const ZERO: Vec3 = [0, 0, 0]

function boxOf(region: BlockVolume): Box {
  const o = region.offset
  return { min: o, max: [o[0] + region.size[0] - 1, o[1] + region.size[1] - 1, o[2] + region.size[2] - 1] }
}

export function boxesOverlap(a: Box, b: Box): boolean {
  for (let i = 0; i < 3; i++) if (a.max[i]! < b.min[i]! || b.max[i]! < a.min[i]!) return false
  return true
}

export function translateBox(box: Box, d: Vec3): Box {
  return { min: addVec3(box.min, d), max: addVec3(box.max, d) }
}

function unionBox(a: Box, b: Box): Box {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  }
}

export function sameVec3(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

export function cellOf(bp: Blueprint, pos: Vec3): CellValue {
  const loc = bp.locate(pos)
  return (loc && loc.region.cellAt(loc.local[0], loc.local[1], loc.local[2])) ?? EMPTY_CELL
}

/** 範囲 box の中身を translate だけ動かす操作を作る（transformRegion の平行移動だけの場合） */
export function moveRegion(bp: Blueprint, box: Box, translate: Vec3, opts: TransformOptions): RegionEditResult {
  return transformRegion(bp, box, translation(translate), opts)
}

/**
 * 範囲 box の中身（ブロック・生データ・エンティティ）を変換 t で写す操作を作る。範囲の中の空きも写す。
 * ブロック状態の向きは opts.states で、生データの中の座標は opts.blockEntity で変える。
 * 行き先にある範囲の外のブロックは、overwrite でなければ断る。
 * 行き先が設計図の外なら、範囲が入っているリージョンを広げる。最小の角が負になるなら、設計図全体を shift だけずらす。
 */
export function transformRegion(bp: Blueprint, box: Box, t: BlockTransform, opts: TransformOptions): RegionEditResult {
  const regionIndex = bp.regions.findIndex((r) => boxContains(boxOf(r), box.min) && boxContains(boxOf(r), box.max))
  if (regionIndex < 0) {
    const touches = bp.regions.some((r) => boxesOverlap(boxOf(r), box))
    return { ok: false, reason: touches ? MOVE_MESSAGES.acrossRegions : MOVE_MESSAGES.outside }
  }
  const region = bp.regions[regionIndex]!
  const target = transformBox(t, box)
  const growth = planGrowth(bp, regionIndex, target)
  if (typeof growth === 'string') return { ok: false, reason: growth }
  const { shift, resize, afterOffset, contentShift } = growth

  // 行き先にある範囲の外のブロック
  let blocked = 0
  forEachInBox(target, (pos) => {
    if (!boxContains(box, pos) && cellOf(bp, pos).state !== null) blocked++
  })
  if (blocked > 0 && !opts.overwrite) return { ok: false, reason: MOVE_MESSAGES.blocked(blocked) }

  // 行き先に書く中身。向きと生データの中の座標を変える
  const states = opts.states ?? transformVanillaState
  let unresolved = 0
  const transformCell = (from: Vec3, to: Vec3): CellValue => {
    const cell = cellOf(bp, from)
    if (cell.state === null || isPureTranslationWithoutHooks(t, opts)) return cell
    const state = isPureTranslation(t) ? cell.state : states(cell.state, t)
    let blockEntity = cell.blockEntity
    if (blockEntity && opts.blockEntity) {
      const result = opts.blockEntity(cell.state, blockEntity, t, from, to, box)
      if (result) {
        blockEntity = result.nbt
        if (result.unresolved) unresolved++
      }
    }
    return state === cell.state && blockEntity === cell.blockEntity ? cell : { state, blockEntity }
  }

  // マスの変更（操作のあとの座標）。元を空にする変更を先に、行き先に書く変更を後に並べる
  const changes: CellChange[] = []
  const written = new Map<string, CellValue>()
  const push = (oldPos: Vec3, after: CellValue): void => {
    const pos = addVec3(oldPos, shift)
    const key = pos.join(',')
    const before = written.get(key) ?? cellOf(bp, oldPos)
    written.set(key, after)
    if (before === after || (before.state === null && after.state === null)) return
    changes.push({ pos, before, after })
  }
  forEachInBox(box, (pos) => push(pos, EMPTY_CELL))
  forEachInBox(box, (pos) => {
    const to = transformPos(t, pos)
    push(to, transformCell(pos, addVec3(to, shift)))
  })

  // エンティティ（リージョンの中の座標で持つ）。範囲の中のものは変換し、リージョンの中身がずれるならそれも足す
  const entities: EntityChange[] = []
  let movedEntity = false
  const after = region.entities.map((e) => {
    const local = entityBlockPos(e)
    const inBox = local !== null && boxContains(box, addVec3(local, region.offset))
    if (!inBox) {
      if (sameVec3(contentShift, ZERO)) return e
      movedEntity = true
      return moveEntity(e, contentShift)
    }
    movedEntity = true
    // 設計図全体の座標で変換し、広げたあとのリージョンの中の座標に戻す
    const toLocal = (v: Vec3): Vec3 => subVec3(addVec3(v, shift), afterOffset)
    return transformEntity(
      e,
      t,
      (p) => toLocal(transformPoint(t, addVec3(p, region.offset))),
      (p) => toLocal(transformPos(t, addVec3(p, region.offset))),
    )
  })
  if (movedEntity) entities.push({ region: regionIndex, before: region.entities, after })

  const label = isPureTranslation(t) ? '範囲を動かす' : t.mirror !== 'none' ? '範囲を反転する' : '範囲を回す'
  const command: EditCommand = {
    label: `${label}（${boxBlockCount(bp, box)} 個）`,
    changes,
    ...(resize.length > 0 ? { resize } : {}),
    ...(entities.length > 0 ? { entities } : {}),
    relocation: { source: box, target: translateBox(target, shift), transform: t, shift },
  }
  const warnings: string[] = []
  if (!sameVec3(shift, ZERO)) warnings.push(shiftMessage(shift))
  if (unresolved > 0) warnings.push(MOVE_MESSAGES.unresolvedBlockEntity(unresolved))
  return { ok: true, command, box: translateBox(target, shift), warnings }
}

/** 行き先を入れるために、リージョンを広げる計画 */
export interface RegionGrowth {
  /** 設計図全体の座標のずれ（負の向きに広げたとき） */
  readonly shift: Vec3
  readonly resize: RegionResize[]
  /** 広げたあとのリージョンの offset */
  readonly afterOffset: Vec3
  /** リージョンの中の座標のずれ（中身とエンティティが動く分） */
  readonly contentShift: Vec3
}

/**
 * リージョン regionIndex を、行き先 target（今の座標）が入るように広げる計画を作る。
 * 各辺の上限を超える・ほかのリージョンに重なるなら、断る理由を返す
 */
export function planGrowth(bp: Blueprint, regionIndex: number, target: Box): RegionGrowth | string {
  const region = bp.regions[regionIndex]!
  const grown = unionBox(boxOf(region), target)
  for (let i = 0; i < 3; i++) {
    if (grown.max[i]! - grown.min[i]! + 1 > MAX_BLUEPRINT_SIDE) return MOVE_MESSAGES.tooLarge
  }
  if (bp.regions.some((r, i) => i !== regionIndex && boxesOverlap(boxOf(r), grown))) return MOVE_MESSAGES.overlapsRegion

  // 全体のずれ。最小の角を 0 にそろえる
  const shift: Vec3 = [Math.max(0, -grown.min[0]), Math.max(0, -grown.min[1]), Math.max(0, -grown.min[2])]
  const resize: RegionResize[] = []
  bp.regions.forEach((r, i) => {
    const before = { offset: r.offset, size: r.size }
    const after =
      i === regionIndex
        ? {
            offset: addVec3(grown.min, shift),
            size: [grown.max[0] - grown.min[0] + 1, grown.max[1] - grown.min[1] + 1, grown.max[2] - grown.min[2] + 1] as Vec3,
          }
        : { offset: addVec3(r.offset, shift), size: r.size }
    if (!sameVec3(before.offset, after.offset) || !sameVec3(before.size, after.size)) {
      resize.push({ region: i, before, after, shift })
    }
  })
  const r = resize.find((x) => x.region === regionIndex)
  return {
    shift,
    resize,
    afterOffset: r ? r.after.offset : region.offset,
    contentShift: r ? subVec3(addVec3(r.before.offset, shift), r.after.offset) : ZERO,
  }
}

/** リージョンの範囲（設計図全体の座標） */
export function regionBox(region: BlockVolume): Box {
  return boxOf(region)
}

// 平行移動だけで、生データを直す関数もないなら、中身はそのまま写せる
function isPureTranslationWithoutHooks(t: BlockTransform, opts: TransformOptions): boolean {
  return isPureTranslation(t) && !opts.blockEntity
}

// 「設計図を負の向きに広げたので、座標が x +2・z +1 ずれました」
export function shiftMessage(shift: Vec3): string {
  const parts = (['x', 'y', 'z'] as const).flatMap((axis, i) => (shift[i] ? [`${axis} +${shift[i]}`] : []))
  return `設計図を負の向きに広げたので、座標が ${parts.join('・')} ずれました`
}

function boxBlockCount(bp: Blueprint, box: Box): number {
  let n = 0
  forEachInBox(box, (pos) => {
    if (cellOf(bp, pos).state !== null) n++
  })
  return n
}

/** エンティティのブロックの位置（リージョンの中の座標）。blockPos、なければ pos から。読めなければ null */
export function entityBlockPos(e: RawEntity): Vec3 | null {
  const blockPos = numberList(e.value.get('blockPos'))
  if (blockPos) return [Math.floor(blockPos[0]), Math.floor(blockPos[1]), Math.floor(blockPos[2])]
  const pos = numberList(e.value.get('pos'))
  return pos ? [Math.floor(pos[0]), Math.floor(pos[1]), Math.floor(pos[2])] : null
}

function numberList(tag: NbtTag | undefined): Vec3 | null {
  if (tag?.type !== 'list' || tag.value.length !== 3) return null
  const out: number[] = []
  for (const t of tag.value) {
    if (t.type !== 'int' && t.type !== 'double' && t.type !== 'float') return null
    out.push(t.value)
  }
  return [out[0]!, out[1]!, out[2]!]
}

// 3つの数のリストを map で写したもの。読めなければ元のまま
function mapList(tag: NbtTag, map: (v: Vec3) => Vec3): NbtTag {
  const v = numberList(tag)
  if (!v || tag.type !== 'list') return tag
  const next = map(v)
  return {
    type: 'list',
    elementType: tag.elementType,
    value: tag.value.map((t, i) => ({ ...t, value: next[i]! }) as NbtTag),
  }
}

// 壁掛けの物（額縁・絵）の nbt の TileX・TileY・TileZ に d を足す
function shiftTile(inner: Map<string, NbtTag>, d: Vec3): void {
  ;(['TileX', 'TileY', 'TileZ'] as const).forEach((key, i) => {
    const tag = inner.get(key)
    if (tag?.type === 'int') inner.set(key, { type: 'int', value: tag.value + d[i]! })
  })
}

/**
 * エンティティを d だけ動かした写しを作る。pos・blockPos と、壁掛けの物（額縁・絵）の nbt の TileX・TileY・TileZ を直す。
 * nbt の Pos はゲームが置くときに pos から作り直すので、そのままにする
 */
export function moveEntity(e: RawEntity, d: Vec3): RawEntity {
  return transformEntity(e, translation(d), (p) => addVec3(p, d), (p) => addVec3(p, d))
}

/**
 * エンティティを変換した写しを作る。mapPoint は pos、mapCell は blockPos の行き先（どちらもリージョンの中の座標）。
 * TileX・TileY・TileZ は blockPos の動いた分だけ直す。回転・反転なら、向き（nbt の Rotation の yaw）と、
 * 額縁の Facing（上下を含む向きの番号）、絵の facing・Facing（水平の向きの番号）も変える
 */
export function transformEntity(
  e: RawEntity,
  t: BlockTransform,
  mapPoint: (v: Vec3) => Vec3,
  mapCell: (v: Vec3) => Vec3,
): RawEntity {
  const value = new Map(e.value)
  const pos = value.get('pos')
  if (pos) value.set('pos', mapList(pos, mapPoint))
  const oldCell = entityBlockPos(e)
  const blockPos = value.get('blockPos')
  if (blockPos) value.set('blockPos', mapList(blockPos, (v) => mapCell([Math.floor(v[0]), Math.floor(v[1]), Math.floor(v[2])])))
  const inner = value.get('nbt')
  if (inner?.type === 'compound') {
    const innerValue = new Map(inner.value)
    if (oldCell) shiftTile(innerValue, subVec3(mapCell(oldCell), oldCell))
    if (!isPureTranslation(t)) transformEntityFacing(innerValue, t)
    value.set('nbt', { type: 'compound', value: innerValue } satisfies RawNbt)
  }
  return { type: 'compound', value }
}

// 絵の facing（水平の向きの番号）。Minecraft の Direction.get2DDataValue の順
const DIRECTIONS_2D: readonly Direction[] = ['south', 'west', 'north', 'east']

function transformEntityFacing(inner: Map<string, NbtTag>, t: BlockTransform): void {
  // yaw：0 が south、90 が west（上から見て右回り）。x の反転で −yaw、z の反転で 180 − yaw、回転で +90 ずつ
  const rotation = inner.get('Rotation')
  if (rotation?.type === 'list' && rotation.value.length === 2) {
    const yawTag = rotation.value[0]
    if (yawTag && (yawTag.type === 'float' || yawTag.type === 'double')) {
      let yaw = yawTag.value
      if (t.mirror === 'x') yaw = -yaw
      if (t.mirror === 'z') yaw = 180 - yaw
      yaw = (((yaw + 90 * t.quarterTurns) % 360) + 360) % 360
      inner.set('Rotation', { ...rotation, value: [{ ...yawTag, value: yaw }, rotation.value[1]!] } as NbtTag)
    }
  }
  const id = inner.get('id')
  const entityId = id?.type === 'string' ? id.value : ''
  const isFrame = entityId.endsWith('item_frame')
  for (const key of ['Facing', 'facing']) {
    const tag = inner.get(key)
    if (tag?.type !== 'byte') continue
    // 額縁は上下を含む番号（Direction.get3DDataValue）、絵は水平の番号
    const table = isFrame ? DIRECTIONS : entityId === 'minecraft:painting' ? DIRECTIONS_2D : null
    const dir = table?.[tag.value]
    if (!table || !dir) continue
    inner.set(key, { type: 'byte', value: table.indexOf(transformDirection(t, dir)) })
  }
}

/**
 * 範囲の操作の前後で、位置 pos がどこへ移るか。forward が false なら元に戻すときの向き。
 * 範囲の中のものは変換と shift、外のものは shift だけ動く。source が null（貼り付け）なら、どれも shift だけ動く
 */
export function relocatePos(r: Relocation, pos: Vec3, forward: boolean): Vec3 {
  if (forward) return addVec3(r.source && boxContains(r.source, pos) ? transformPos(r.transform, pos) : pos, r.shift)
  const unshifted = subVec3(pos, r.shift)
  return r.source && boxContains(r.target, pos) ? inverseTransformPos(r.transform, unshifted) : unshifted
}
