// 設計図の枠の取っ手を引いて大きさを変える口（#201、docs/ui.md「設計図の大きさ」）。3D・2D表示が呼ぶ。
// 離したら「大きさを変える」と同じ操作を履歴に通す。縮めて消えるものがあれば、値を入れた画面を開いて確かめる。

import type { Vec3 } from '../../domain/vec3'
import { resizeRegion, type RegionGrow } from '../../edit/blueprintResize'
import { useDocumentSession } from '../document/documentSession'
import { useBlueprintResizeStore } from '../stores/blueprintResizeStore'
import { useBrushStore } from '../stores/brushStore'
import { frameGrow, frameSizeLabel, grownFrameBox, isNoGrow } from './frameHandles'
import type { FaceHandle } from './rangeHandles'

export interface FrameResize {
  /** 取っ手をつかむ。設計図がない・リージョンが2つ以上なら false */
  begin(face: FaceHandle): boolean
  /** 引いている間。boundary はつかんだ面を動かす先のマスの境目（小数でよい） */
  update(boundary: number): void
  /** 離す。変えたら true（画面を開いたとき・変わらないときは false） */
  finish(): boolean
  /** やめる（見本を消す） */
  cancel(): void
  readonly active: boolean
}

/** 枠の取っ手を出せる設計図か。リージョンが1つだけのとき */
export function frameHandlesAllowed(regions: number): boolean {
  return regions === 1
}

/** 部品の setup の中で呼ぶ */
export function useFrameResize(): FrameResize {
  const session = useDocumentSession()
  const brush = useBrushStore()
  const store = useBlueprintResizeStore()
  let grabbed: { readonly face: FaceHandle; readonly size: Vec3; grow: RegionGrow } | null = null

  function plan(grow: RegionGrow) {
    const bp = session.current.value?.blueprint
    return bp ? resizeRegion(bp, 0, grow) : null
  }

  function cancel(): void {
    if (!grabbed) return
    grabbed = null
    store.setPreview(null)
    brush.setMessage(null)
  }

  return {
    begin(face) {
      const bp = session.current.value?.blueprint
      if (!bp || !frameHandlesAllowed(bp.regions.length)) return false
      const size = bp.size
      grabbed = { face, size, grow: { min: [0, 0, 0], max: [0, 0, 0] } }
      brush.setMessage(frameSizeLabel(size, grabbed.grow, 0))
      return true
    },
    update(boundary) {
      if (!grabbed) return
      const grow = frameGrow(grabbed.size, grabbed.face, boundary)
      grabbed.grow = grow
      if (isNoGrow(grow)) {
        store.setPreview(null)
        brush.setMessage(frameSizeLabel(grabbed.size, grow, 0))
        return
      }
      const p = plan(grow)
      const removed = p && typeof p !== 'string' ? p.removedBlocks : 0
      const removes = p !== null && typeof p !== 'string' && p.removedBlocks + p.removedEntities > 0
      store.setPreview({ box: grownFrameBox(grabbed.size, grow), removes })
      brush.setMessage(typeof p === 'string' ? p : frameSizeLabel(grabbed.size, grow, removed))
    },
    finish() {
      if (!grabbed) return false
      const grow = grabbed.grow
      grabbed = null
      store.setPreview(null)
      if (isNoGrow(grow)) {
        brush.setMessage(null)
        return false
      }
      const p = plan(grow)
      if (p === null) {
        brush.setMessage(null)
        return false
      }
      if (typeof p === 'string') {
        brush.setMessage(p)
        return false
      }
      // 消えるものがあるときは、値を入れた画面で確かめる
      if (p.removedBlocks + p.removedEntities > 0) {
        brush.setMessage(null)
        store.openDialog(grow)
        return false
      }
      if (!session.apply(p.command)) return false
      brush.setMessage(p.warnings.length > 0 ? p.warnings.join('。') : null)
      return true
    },
    cancel,
    get active() {
      return grabbed !== null
    },
  }
}
