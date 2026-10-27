// コピー・切り取り・貼り付け（docs/design.md「範囲の編集」、#133）。Blueprint は変えず、切り抜きか操作（EditCommand）だけを返す。
// 貼り付けは範囲を動かす操作と同じく、行き先がはみ出せば設計図を広げる（planGrowth）。

import type { Blueprint } from '../domain/blueprint'
import { EMPTY_CELL, type CellValue, type RawEntity } from '../domain/blockVolume'
import { isPureTranslation, transformBox, transformPoint, transformPos, type BlockTransform } from '../domain/blockTransform'
import { boxContains, forEachInBox, type Box } from '../domain/box'
import { addVec3, subVec3, type Vec3 } from '../domain/vec3'
import type { CellChange, EditCommand, EntityChange } from './editCommand'
import {
  boxesOverlap,
  cellOf,
  entityBlockPos,
  MOVE_MESSAGES,
  moveEntity,
  planGrowth,
  regionBox,
  sameVec3,
  shiftMessage,
  transformEntity,
  translateBox,
  type RegionEditResult,
  type TransformOptions,
} from './regionTransform'
import { transformVanillaState } from './stateTransform'

/** 切り抜き。範囲の最小の角からの相対位置で持つ。空きマスは持たない */
export interface BlueprintClip {
  /** 範囲の大きさ */
  readonly size: Vec3
  readonly cells: readonly { readonly pos: Vec3; readonly cell: CellValue }[]
  /** 位置は切り抜きの中の相対位置に直したもの */
  readonly entities: readonly RawEntity[]
  /** 元の設計図の dataVersion */
  readonly dataVersion: number
}

/** 断る理由と知らせ（そのまま状態表示に出す） */
export const CLIP_MESSAGES = {
  blocked: (count: number) => `貼る先にブロックがあります（${count} 個）。Ctrl を押しながらクリックすると上書きします`,
  dataVersion: (from: number, to: number) => `切り抜きの元の設計図とデータの版が違います（元 ${from}、今 ${to}）`,
  noRegion: '設計図にリージョンがないので貼れません',
} as const

/** 切り抜きの中の箱（最小の角が [0, 0, 0]） */
export function clipBox(clip: BlueprintClip): Box {
  return { min: [0, 0, 0], max: [clip.size[0] - 1, clip.size[1] - 1, clip.size[2] - 1] }
}

/** 範囲 box の中身（ブロックがあるマスと生データ、エンティティ）を写した切り抜きを作る。リージョンをまたいでよい */
export function copyRegion(bp: Blueprint, box: Box): BlueprintClip {
  const cells: { pos: Vec3; cell: CellValue }[] = []
  forEachInBox(box, (pos) => {
    const cell = cellOf(bp, pos)
    if (cell.state !== null) cells.push({ pos: subVec3(pos, box.min), cell })
  })
  const entities: RawEntity[] = []
  for (const region of bp.regions) {
    // リージョンの中の座標から、切り抜きの中の座標へ
    const d = subVec3(region.offset, box.min)
    for (const e of region.entities) {
      const local = entityBlockPos(e)
      if (local !== null && boxContains(box, addVec3(local, region.offset))) entities.push(moveEntity(e, d))
    }
  }
  return {
    size: [box.max[0] - box.min[0] + 1, box.max[1] - box.min[1] + 1, box.max[2] - box.min[2] + 1],
    cells,
    entities,
    dataVersion: bp.dataVersion,
  }
}

/** 範囲 box の中のブロックとエンティティを消す操作（切り取り）。消すものがなければ null */
export function cutRegion(bp: Blueprint, box: Box): EditCommand | null {
  const changes: CellChange[] = []
  forEachInBox(box, (pos) => {
    const before = cellOf(bp, pos)
    if (before.state !== null) changes.push({ pos, before, after: EMPTY_CELL })
  })
  const entities: EntityChange[] = []
  bp.regions.forEach((region, i) => {
    const after = region.entities.filter((e) => {
      const local = entityBlockPos(e)
      return local === null || !boxContains(box, addVec3(local, region.offset))
    })
    if (after.length !== region.entities.length) entities.push({ region: i, before: region.entities, after })
  })
  if (changes.length === 0 && entities.length === 0) return null
  return {
    label: `範囲を切り取る（${changes.length} 個）`,
    changes,
    ...(entities.length > 0 ? { entities } : {}),
  }
}

/** 切り抜きを at に貼るときの、切り抜きの中の座標から設計図全体の座標への変換。回した切り抜きの最小の角が at に来る */
export function pasteTransform(clip: BlueprintClip, at: Vec3, t: BlockTransform): BlockTransform {
  const base: BlockTransform = { ...t, translate: [0, 0, 0] }
  const min = transformBox(base, clipBox(clip)).min
  return { ...base, translate: subVec3(at, min) }
}

/** 切り抜きを at に貼ったときの、ブロックを書くマス（設計図全体の座標） */
export function pasteCells(clip: BlueprintClip, at: Vec3, t: BlockTransform): Vec3[] {
  const tt = pasteTransform(clip, at, t)
  return clip.cells.map((c) => transformPos(tt, c.pos))
}

/** 切り抜きを at に貼ったときに上書きするブロックの数 */
export function pasteOverlapCount(bp: Blueprint, clip: BlueprintClip, at: Vec3, t: BlockTransform): number {
  return pasteCells(clip, at, t).filter((pos) => bp.get(pos) !== null).length
}

// 貼るリージョン。at が入っているもの、なければ行き先に重なる最初のもの、それもなければ最初のもの
function pasteRegionIndex(bp: Blueprint, at: Vec3, target: Box): number {
  const containing = bp.regions.findIndex((r) => boxContains(regionBox(r), at))
  if (containing >= 0) return containing
  const overlapping = bp.regions.findIndex((r) => boxesOverlap(regionBox(r), target))
  return overlapping >= 0 ? overlapping : 0
}

/**
 * 切り抜きを、t で回し・反転して、最小の角を at に合わせて貼る操作を作る（t の translate は使わない）。
 * 書くのは切り抜きのブロックがあるマスだけ。行き先にブロックがあれば、overwrite でなければ断る。
 * 行き先が設計図の外なら、貼るリージョンを広げる
 */
export function pasteClip(bp: Blueprint, clip: BlueprintClip, at: Vec3, t: BlockTransform, opts: TransformOptions): RegionEditResult {
  if (bp.regions.length === 0) return { ok: false, reason: CLIP_MESSAGES.noRegion }
  const tt = pasteTransform(clip, at, t)
  const source = clipBox(clip)
  const target = transformBox(tt, source)
  const regionIndex = pasteRegionIndex(bp, at, target)
  const region = bp.regions[regionIndex]!

  const blocked = pasteOverlapCount(bp, clip, at, t)
  if (blocked > 0 && !opts.overwrite) return { ok: false, reason: CLIP_MESSAGES.blocked(blocked) }

  const growth = planGrowth(bp, regionIndex, target)
  if (typeof growth === 'string') return { ok: false, reason: growth }
  const { shift, resize, afterOffset, contentShift } = growth

  // 書く中身。向きと生データの中の座標を変える
  const states = opts.states ?? transformVanillaState
  let unresolved = 0
  const changes: CellChange[] = []
  for (const { pos: from, cell } of clip.cells) {
    const to = transformPos(tt, from)
    const pos = addVec3(to, shift)
    let after = cell
    if (cell.state !== null) {
      const state = isPureTranslation(tt) ? cell.state : states(cell.state, tt)
      let blockEntity = cell.blockEntity
      if (blockEntity && opts.blockEntity) {
        const result = opts.blockEntity(cell.state, blockEntity, tt, from, pos, source)
        if (result) {
          blockEntity = result.nbt
          if (result.unresolved) unresolved++
        }
      }
      if (state !== cell.state || blockEntity !== cell.blockEntity) after = { state, blockEntity }
    }
    const before = cellOf(bp, to)
    if (before === after) continue
    changes.push({ pos, before, after })
  }

  // エンティティ（リージョンの中の座標で持つ）。今あるものはリージョンの中身のずれだけ直し、切り抜きのものを足す
  const toLocal = (v: Vec3): Vec3 => subVec3(addVec3(v, shift), afterOffset)
  const kept = sameVec3(contentShift, [0, 0, 0]) ? region.entities : region.entities.map((e) => moveEntity(e, contentShift))
  const pasted = clip.entities.map((e) =>
    transformEntity(
      e,
      tt,
      (p) => toLocal(transformPoint(tt, p)),
      (p) => toLocal(transformPos(tt, p)),
    ),
  )
  const entities: EntityChange[] =
    pasted.length > 0 || kept !== region.entities ? [{ region: regionIndex, before: region.entities, after: [...kept, ...pasted] }] : []

  const pastedBox = translateBox(target, shift)
  const command: EditCommand = {
    label: `貼り付け（${clip.cells.length} 個）`,
    changes,
    ...(resize.length > 0 ? { resize } : {}),
    ...(entities.length > 0 ? { entities } : {}),
    relocation: { source: null, target: pastedBox, transform: tt, shift },
  }
  const warnings: string[] = []
  if (!sameVec3(shift, [0, 0, 0])) warnings.push(shiftMessage(shift))
  if (unresolved > 0) warnings.push(MOVE_MESSAGES.unresolvedBlockEntity(unresolved))
  if (clip.dataVersion !== bp.dataVersion) warnings.push(CLIP_MESSAGES.dataVersion(clip.dataVersion, bp.dataVersion))
  return { ok: true, command, box: pastedBox, warnings }
}
