// 切り抜きと貼り付けの見本（#133、docs/ui.md「コピー・切り取り・貼り付け」）。
// どちらも画面の状態。切り抜きは別の設計図を開いても残す（アプリを閉じると消える）。

import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef } from 'vue'
import type { BlockState } from '../../domain/blockState'
import { boxFromCorners, type Box } from '../../domain/box'
import type { BlockTransform, QuarterTurns } from '../../domain/blockTransform'
import type { Vec3 } from '../../domain/vec3'
import { pasteTransform, type BlueprintClip } from '../../edit/regionClip'
import { transformPos } from '../../domain/blockTransform'

/** 見本の1マス（設計図全体の座標）と、そこに置くブロック（回す前の状態。色だけに使う） */
export interface PasteCell {
  readonly pos: Vec3
  readonly state: BlockState
}

export const usePasteStore = defineStore('paste', () => {
  /** 切り抜き。まだ写していなければ null */
  const clip = shallowRef<BlueprintClip | null>(null)
  /** 見本を出しているか */
  const active = ref(false)
  /** 見本を回した数（右回りの 90° の数） */
  const turns = ref<QuarterTurns>(0)
  /** 見本の最小の角。マウスが表示の外にあって、まだどこにも出していなければ null */
  const at = shallowRef<Vec3 | null>(null)
  /** 見本が設計図のブロックに重なるか（赤く出す） */
  const blocked = ref(false)

  /** 切り抜きの中の座標で回す変換 */
  const transform = computed<BlockTransform>(() => ({ translate: [0, 0, 0], quarterTurns: turns.value, mirror: 'none', pivot: [0, 0, 0] }))

  /** 見本のマス。見本を出していなければ空 */
  const cells = computed<readonly PasteCell[]>(() => {
    const c = clip.value
    const p = at.value
    if (!active.value || !c || !p) return []
    const t = pasteTransform(c, p, transform.value)
    return c.cells.map(({ pos, cell }) => ({ pos: transformPos(t, pos), state: cell.state! }))
  })

  /** 見本の箱。見本を出していなければ null */
  const box = computed<Box | null>(() => {
    const c = clip.value
    const p = at.value
    if (!active.value || !c || !p) return null
    const [sx, sy, sz] = c.size
    const [w, d] = turns.value % 2 === 1 ? [sz, sx] : [sx, sz]
    return boxFromCorners(p, [p[0] + w - 1, p[1] + sy - 1, p[2] + d - 1])
  })

  function setClip(next: BlueprintClip): void {
    clip.value = markRaw(next)
  }

  /** 見本を出す。start は最初に出す位置（複製）。なければマウスが来るまで出さない */
  function start(startAt: Vec3 | null): void {
    active.value = true
    turns.value = 0
    at.value = startAt
    blocked.value = false
  }

  function stop(): void {
    active.value = false
    at.value = null
    blocked.value = false
  }

  /** 見本を回す。quarter は右回りの 90° の数（左回りは 3） */
  function rotate(quarter: QuarterTurns): void {
    turns.value = ((turns.value + quarter) % 4) as QuarterTurns
  }

  function moveTo(next: Vec3 | null, isBlocked: boolean): void {
    at.value = next
    blocked.value = next !== null && isBlocked
  }

  function setBlocked(next: boolean): void {
    blocked.value = next
  }

  return { clip, active, turns, at, blocked, transform, cells, box, setClip, start, stop, rotate, moveTo, setBlocked }
})
