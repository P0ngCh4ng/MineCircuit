// コピー・切り取り・貼り付け・複製を、画面（キー操作と右パネル）から呼ぶ口（#133）。
// docs/ui.md「コピー・切り取り・貼り付け」。中身は edit/regionClip.ts の切り抜きと操作を作り、DocumentSession に渡す。
// 貼り付けの見本を出している間は、ToolController に差し込んだ ToolOverride がマウスを受け取る。

import { onBeforeUnmount, watch } from 'vue'
import type { Blueprint } from '../../domain/blueprint'
import type { QuarterTurns } from '../../domain/blockTransform'
import { boxSize } from '../../domain/box'
import type { Vec3 } from '../../domain/vec3'
import { copyRegion, cutRegion, pasteClip, pasteOverlapCount } from '../../edit/regionClip'
import { useDocumentSession } from '../document/documentSession'
import { useBrushStore } from '../stores/brushStore'
import { usePasteStore } from '../stores/pasteStore'
import { useToolStore } from '../stores/toolStore'
import { placeCell } from '../tools/placeTool'
import type { PickModifiers, PickTarget, ToolOverride } from '../tools/tool'
import { transformBlockEntity, transformBlockState } from './placementRules'
import { REGION_MESSAGES } from './regionActions'

export interface ClipboardActions {
  /** 範囲を切り抜きに写す。写したら true */
  copy(): boolean
  /** 範囲を写してから消す。消したら true */
  cut(): boolean
  /** 貼り付けの見本を出す。切り抜きがなければ false */
  paste(): boolean
  /** 範囲を写し、すぐ隣（x の正の向き）に貼る見本を出す */
  duplicate(): boolean
  /** 見本を回す。見本を出していなければ false */
  rotatePreview(turns: QuarterTurns): boolean
  /** 貼り付けをやめる。見本を出していなければ false */
  cancel(): boolean
}

/** 状態表示に出す知らせ */
export const CLIPBOARD_MESSAGES = {
  copied: (count: number) => `範囲をコピーしました（${count} 個）。Ctrl+V で貼ります`,
  emptyCopy: '範囲の中にブロックがありません',
  noClip: '貼るものがありません。範囲を選んで Ctrl+C でコピーしてください',
  pasting: '貼る所をクリックしてください。R で回す、Ctrl+クリックで上書き、Esc でやめる',
} as const

// 見本の最小の角。置くときと同じく、3D はクリックした面の隣、2D は今の段のマス
function anchorOf(target: PickTarget): Vec3 {
  return placeCell(target, { shift: false }).pos
}

/** 部品の setup の中で呼ぶ */
export function useClipboardActions(): ClipboardActions {
  const session = useDocumentSession()
  const tools = useToolStore()
  const brush = useBrushStore()
  const paste = usePasteStore()

  function blueprintAndBox() {
    const bp = session.current.value?.blueprint
    if (!bp) {
      brush.setMessage(REGION_MESSAGES.noBlueprint)
      return null
    }
    const box = tools.selectionBox
    if (!box) {
      brush.setMessage(REGION_MESSAGES.noSelection)
      return null
    }
    return { bp, box }
  }

  function blocked(bp: Blueprint, at: Vec3): boolean {
    const clip = paste.clip
    return clip !== null && pasteOverlapCount(bp, clip, at, paste.transform) > 0
  }

  const override: ToolOverride = {
    onHover(target) {
      // 表示の外に出たら、見本は最後の所に残す
      const bp = session.current.value?.blueprint
      if (!target || !bp) return
      const at = anchorOf(target)
      paste.moveTo(at, blocked(bp, at))
    },
    onClick(target: PickTarget, mods: PickModifiers) {
      const bp = session.current.value?.blueprint
      const clip = paste.clip
      if (!bp || !clip) return
      const at = anchorOf(target)
      const result = pasteClip(bp, clip, at, paste.transform, {
        overwrite: mods.ctrl === true,
        states: transformBlockState,
        blockEntity: transformBlockEntity,
      })
      if (!result.ok) {
        paste.moveTo(at, true)
        brush.setMessage(result.reason)
        return
      }
      stop()
      // 選択範囲は、session.onRelocate を受けて貼った所になる（relocationSync.ts）
      session.apply(result.command)
      brush.setMessage(result.warnings.length > 0 ? result.warnings.join('。') : null)
    },
  }

  function start(at: Vec3 | null): boolean {
    if (!paste.clip) {
      brush.setMessage(CLIPBOARD_MESSAGES.noClip)
      return false
    }
    if (!session.current.value) {
      brush.setMessage(REGION_MESSAGES.noBlueprint)
      return false
    }
    paste.start(at)
    tools.setOverride(override)
    const bp = session.current.value.blueprint
    if (paste.at) paste.setBlocked(blocked(bp, paste.at))
    brush.setMessage(CLIPBOARD_MESSAGES.pasting)
    return true
  }

  function stop(): void {
    paste.stop()
    tools.setOverride(null)
  }

  function copy(): boolean {
    const got = blueprintAndBox()
    if (!got) return false
    const clip = copyRegion(got.bp, got.box)
    if (clip.cells.length === 0 && clip.entities.length === 0) {
      brush.setMessage(CLIPBOARD_MESSAGES.emptyCopy)
      return false
    }
    paste.setClip(clip)
    brush.setMessage(CLIPBOARD_MESSAGES.copied(clip.cells.length))
    return true
  }

  return {
    copy,
    cut() {
      const got = blueprintAndBox()
      if (!got) return false
      const cmd = cutRegion(got.bp, got.box)
      if (!cmd) {
        brush.setMessage(CLIPBOARD_MESSAGES.emptyCopy)
        return false
      }
      paste.setClip(copyRegion(got.bp, got.box))
      session.apply(cmd)
      brush.setMessage(null)
      return true
    },
    paste: () => start(null),
    duplicate() {
      const box = tools.selectionBox
      if (!box || !copy()) return false
      return start([box.min[0] + boxSize(box)[0], box.min[1], box.min[2]])
    },
    rotatePreview(turns) {
      if (!paste.active) return false
      paste.rotate(turns)
      const bp = session.current.value?.blueprint
      if (bp && paste.at) paste.setBlocked(blocked(bp, paste.at))
      return true
    },
    cancel() {
      if (!paste.active) return false
      stop()
      brush.setMessage(null)
      return true
    },
  }
}

/**
 * 貼り付けの見本を、ほかの変化に合わせる。App の setup で1回呼ぶ。
 * ツールを切り替えた・設計図を閉じたらやめ、設計図が変わったら重なりを調べ直す
 */
export function usePasteModeSync(actions: ClipboardActions): void {
  const session = useDocumentSession()
  const tools = useToolStore()
  const paste = usePasteStore()

  const stops = [
    // 切り替えたすぐ後に新しいツールがマウスを受け取れるように、その場でやめる
    watch(
      () => tools.activeToolId,
      () => actions.cancel(),
      { flush: 'sync' },
    ),
    watch(session.current, (doc) => {
      if (!doc) actions.cancel()
    }),
    watch(session.version, () => {
      const bp = session.current.value?.blueprint
      const clip = paste.clip
      if (paste.active && bp && clip && paste.at) paste.setBlocked(pasteOverlapCount(bp, clip, paste.at, paste.transform) > 0)
    }),
  ]
  onBeforeUnmount(() => {
    for (const stop of stops) stop()
    actions.cancel()
  })
}
