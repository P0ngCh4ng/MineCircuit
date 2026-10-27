// 範囲を動かす操作（docs/design.md「範囲の編集」、#131）。Blueprint は変えず、操作（EditCommand）だけを返す。
// 行き先が設計図の外なら設計図を広げる（負の向きなら全体をずらす）。エンティティも一緒に動かす。

import type { Blueprint } from '../domain/blueprint'
import { EMPTY_CELL, type BlockVolume, type CellValue, type RawEntity } from '../domain/blockVolume'
import { boxContains, forEachInBox, type Box } from '../domain/box'
import type { NbtTag, RawNbt } from '../domain/nbt'
import { addVec3, subVec3, type Vec3 } from '../domain/vec3'
import type { CellChange, EditCommand, EntityChange, RegionResize, Relocation } from './editCommand'

/** 設計図の各辺の大きさの上限 */
export const MAX_BLUEPRINT_SIDE = 512

/** 範囲の操作の結果。作れたときは操作と、動いた先の範囲（操作のあとの座標） */
export type RegionEditResult =
  | { readonly ok: true; readonly command: EditCommand; readonly box: Box; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly reason: string }

export interface MoveOptions {
  /** 行き先にある範囲の外のブロックを上書きするか */
  readonly overwrite: boolean
}

/** 断る理由（そのまま状態表示に出す） */
export const MOVE_MESSAGES = {
  outside: '範囲が設計図の外にあります。設計図の中を選んでください',
  acrossRegions: '範囲が2つ以上のリージョンにまたがっています。1つのリージョンの中を選んでください',
  tooLarge: `設計図が各辺 ${MAX_BLUEPRINT_SIDE} を超えるので動かせません`,
  overlapsRegion: '動かす先がほかのリージョンに重なるので動かせません',
  blocked: (count: number) => `動かす先にブロックがあります（${count} 個）。Ctrl を押しながら動かすと上書きします`,
} as const

const ZERO: Vec3 = [0, 0, 0]

function boxOf(region: BlockVolume): Box {
  const o = region.offset
  return { min: o, max: [o[0] + region.size[0] - 1, o[1] + region.size[1] - 1, o[2] + region.size[2] - 1] }
}

function boxesOverlap(a: Box, b: Box): boolean {
  for (let i = 0; i < 3; i++) if (a.max[i]! < b.min[i]! || b.max[i]! < a.min[i]!) return false
  return true
}

function translateBox(box: Box, d: Vec3): Box {
  return { min: addVec3(box.min, d), max: addVec3(box.max, d) }
}

function unionBox(a: Box, b: Box): Box {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  }
}

function sameVec3(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

function cellOf(bp: Blueprint, pos: Vec3): CellValue {
  const loc = bp.locate(pos)
  return (loc && loc.region.cellAt(loc.local[0], loc.local[1], loc.local[2])) ?? EMPTY_CELL
}

/**
 * 範囲 box の中身（ブロック・生データ・エンティティ）を translate だけ動かす操作を作る。範囲の中の空きも写す。
 * 行き先にある範囲の外のブロックは、overwrite でなければ断る。
 * 行き先が設計図の外なら、範囲が入っているリージョンを広げる。最小の角が負になるなら、設計図全体を shift だけずらす。
 */
export function moveRegion(bp: Blueprint, box: Box, translate: Vec3, opts: MoveOptions): RegionEditResult {
  const regionIndex = bp.regions.findIndex((r) => boxContains(boxOf(r), box.min) && boxContains(boxOf(r), box.max))
  if (regionIndex < 0) {
    const touches = bp.regions.some((r) => boxesOverlap(boxOf(r), box))
    return { ok: false, reason: touches ? MOVE_MESSAGES.acrossRegions : MOVE_MESSAGES.outside }
  }
  const region = bp.regions[regionIndex]!
  const target = translateBox(box, translate)

  // 広げたあとのリージョンの範囲（今の座標）。ほかのリージョンに重なれば断る
  const grown = unionBox(boxOf(region), target)
  for (let i = 0; i < 3; i++) {
    if (grown.max[i]! - grown.min[i]! + 1 > MAX_BLUEPRINT_SIDE) return { ok: false, reason: MOVE_MESSAGES.tooLarge }
  }
  if (bp.regions.some((r, i) => i !== regionIndex && boxesOverlap(boxOf(r), grown))) {
    return { ok: false, reason: MOVE_MESSAGES.overlapsRegion }
  }

  // 行き先にある範囲の外のブロック
  let blocked = 0
  forEachInBox(target, (pos) => {
    if (!boxContains(box, pos) && cellOf(bp, pos).state !== null) blocked++
  })
  if (blocked > 0 && !opts.overwrite) return { ok: false, reason: MOVE_MESSAGES.blocked(blocked) }

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
  forEachInBox(box, (pos) => push(addVec3(pos, translate), cellOf(bp, pos)))

  // エンティティ。範囲の中のものは translate だけ、リージョンの中身がずれるならそれも足す
  const entities: EntityChange[] = []
  const r = resize.find((x) => x.region === regionIndex)
  const contentShift = r ? subVec3(addVec3(r.before.offset, shift), r.after.offset) : ZERO
  let movedEntity = false
  const after = region.entities.map((e) => {
    const local = entityBlockPos(e)
    const inBox = local !== null && boxContains(box, addVec3(local, region.offset))
    const delta = inBox ? addVec3(contentShift, translate) : contentShift
    if (sameVec3(delta, ZERO)) return e
    movedEntity = true
    return moveEntity(e, delta)
  })
  if (movedEntity) entities.push({ region: regionIndex, before: region.entities, after })

  const command: EditCommand = {
    label: `範囲を動かす（${boxBlockCount(bp, box)} 個）`,
    changes,
    ...(resize.length > 0 ? { resize } : {}),
    ...(entities.length > 0 ? { entities } : {}),
    relocation: { source: box, target: translateBox(target, shift), translate, shift },
  }
  const warnings = sameVec3(shift, ZERO) ? [] : [shiftMessage(shift)]
  return { ok: true, command, box: translateBox(target, shift), warnings }
}

// 「設計図を負の向きに広げたので、座標が x +2・z +1 ずれました」
function shiftMessage(shift: Vec3): string {
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

// 3つの数のリストに d を足した写し。読めなければ元のまま
function shiftList(tag: NbtTag, d: Vec3): NbtTag {
  if (tag.type !== 'list' || tag.value.length !== 3) return tag
  if (!tag.value.every((t) => t.type === 'int' || t.type === 'double' || t.type === 'float')) return tag
  return {
    type: 'list',
    elementType: tag.elementType,
    value: tag.value.map((t, i) => ({ ...t, value: (t.value as number) + d[i]! }) as NbtTag),
  }
}

/**
 * エンティティを d だけ動かした写しを作る。pos・blockPos と、壁掛けの物（額縁・絵）の nbt の TileX・TileY・TileZ を直す。
 * nbt の Pos はゲームが置くときに pos から作り直すので、そのままにする
 */
export function moveEntity(e: RawEntity, d: Vec3): RawEntity {
  const value = new Map(e.value)
  for (const key of ['pos', 'blockPos']) {
    const tag = value.get(key)
    if (tag) value.set(key, shiftList(tag, d))
  }
  const inner = value.get('nbt')
  if (inner?.type === 'compound') {
    const innerValue = new Map(inner.value)
    let changed = false
    ;(['TileX', 'TileY', 'TileZ'] as const).forEach((key, i) => {
      const tag = innerValue.get(key)
      if (tag?.type !== 'int') return
      innerValue.set(key, { type: 'int', value: tag.value + d[i]! })
      changed = true
    })
    if (changed) value.set('nbt', { type: 'compound', value: innerValue } satisfies RawNbt)
  }
  return { type: 'compound', value }
}

/**
 * 範囲の操作の前後で、位置 pos がどこへ移るか。forward が false なら元に戻すときの向き。
 * 範囲の中のものは translate と shift、外のものは shift だけ動く
 */
export function relocatePos(r: Relocation, pos: Vec3, forward: boolean): Vec3 {
  if (forward) return addVec3(pos, boxContains(r.source, pos) ? addVec3(r.translate, r.shift) : r.shift)
  return subVec3(pos, boxContains(r.target, pos) ? addVec3(r.translate, r.shift) : r.shift)
}
