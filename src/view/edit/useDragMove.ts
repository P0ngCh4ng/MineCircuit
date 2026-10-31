// 範囲をマウスでつかんで動かす・写す口（#199、docs/ui.md「動かす」）。3D・2D表示が呼ぶ。
// ドラッグを始めたときの中身を写しておき、ドラッグ中は見本を、離したら今の「動かす」か貼り付けの操作を書く。

import type { Box } from '../../domain/box'
import { translation } from '../../domain/blockTransform'
import { addVec3, type Vec3 } from '../../domain/vec3'
import { copyRegion, pasteClip, type BlueprintClip } from '../../edit/regionClip'
import { useDocumentSession } from '../document/documentSession'
import { useBrushStore } from '../stores/brushStore'
import { useDragMoveStore } from '../stores/dragMoveStore'
import { useToolStore } from '../stores/toolStore'
import type { PickModifiers } from '../tools/tool'
import { DRAG_MOVE_MESSAGES, previewMove } from './dragMove'
import { transformBlockEntity, transformBlockState } from './placementRules'
import { useRegionActions } from './regionActions'

export interface DragMove {
  /** 選択範囲をつかむ。範囲がなければ false */
  begin(): boolean
  /** つかんでいる間のずれ。見本と状態表示を変える */
  update(d: Vec3, mods: PickModifiers): void
  /** 離す。動かした・写したら true。ずれがなければやめるだけ */
  finish(d: Vec3, mods: PickModifiers): boolean
  /** やめる（見本を消す） */
  cancel(): void
  /** つかんでいる間は true */
  readonly active: boolean
}

const isZero = (d: Vec3) => d[0] === 0 && d[1] === 0 && d[2] === 0

/** 部品の setup の中で呼ぶ */
export function useDragMove(): DragMove {
  const session = useDocumentSession()
  const tools = useToolStore()
  const brush = useBrushStore()
  const store = useDragMoveStore()
  const actions = useRegionActions()

  let grabbed: { readonly box: Box; readonly clip: BlueprintClip } | null = null

  function cancel(): void {
    if (!grabbed) return
    grabbed = null
    store.setPreview(null)
    brush.setMessage(null)
  }

  function copyTo(d: Vec3, overwrite: boolean): boolean {
    const bp = session.current.value?.blueprint
    if (!bp || !grabbed) return false
    const result = pasteClip(bp, grabbed.clip, addVec3(grabbed.box.min, d), translation([0, 0, 0]), {
      overwrite,
      states: transformBlockState,
      blockEntity: transformBlockEntity,
    })
    if (!result.ok) {
      brush.setMessage(result.reason)
      return false
    }
    // 選択範囲は、session.onRelocate を受けて写した所になる（relocationSync.ts）
    session.apply(result.command)
    brush.setMessage(result.warnings.length > 0 ? result.warnings.join('。') : null)
    return true
  }

  return {
    begin() {
      const bp = session.current.value?.blueprint
      const box = tools.selectionBox
      if (!bp || !box) return false
      grabbed = { box, clip: copyRegion(bp, box) }
      return true
    },
    update(d, mods) {
      const bp = session.current.value?.blueprint
      if (!bp || !grabbed) return
      if (isZero(d)) {
        store.setPreview(null)
        brush.setMessage(DRAG_MOVE_MESSAGES.moving(d, mods.alt === true))
        return
      }
      const copy = mods.alt === true
      const preview = previewMove(bp, grabbed.clip, grabbed.box, d, copy)
      store.setPreview(preview)
      brush.setMessage(preview.blocked > 0 && !mods.ctrl ? DRAG_MOVE_MESSAGES.blocked(preview.blocked, copy) : DRAG_MOVE_MESSAGES.moving(d, copy))
    },
    finish(d, mods) {
      if (!grabbed) return false
      if (isZero(d)) {
        cancel()
        return false
      }
      store.setPreview(null)
      const done = mods.alt === true ? copyTo(d, mods.ctrl === true) : actions.move(d, mods.ctrl === true)
      grabbed = null
      return done
    },
    cancel,
    get active() {
      return grabbed !== null
    },
  }
}
