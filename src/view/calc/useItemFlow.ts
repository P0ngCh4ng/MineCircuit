// 物の流れの表示（#231、docs/ui.md「物の流れ」）の印の位置を、時間とともに求める。2D・3D の表示が使う。
// 「物の流れ」を入れていて、物の動きがあるときだけ毎フレーム動かす。ないときは描き続けない。

import { computed, onBeforeUnmount, shallowRef, watch, type ShallowRef } from 'vue'
import { itemDotsAt, timeItemMoves, type ItemDot } from '../../calc/itemFlowDots'
import { useCalcStore } from '../stores/calcStore'
import { useViewStore } from '../stores/viewStore'

/** 印を動かす間隔（ミリ秒） */
const FRAME_INTERVAL = 33

/** 部品の setup の中で呼ぶ */
export function useItemFlow(): ShallowRef<readonly ItemDot[]> {
  const calc = useCalcStore()
  const view = useViewStore()
  const timed = computed(() => (view.showItemFlow ? timeItemMoves(calc.itemMoves) : []))
  const dots = shallowRef<readonly ItemDot[]>([])
  let frame = 0
  let last = -Infinity

  const tick = (now: number): void => {
    frame = requestAnimationFrame(tick)
    if (now - last < FRAME_INTERVAL) return
    last = now
    dots.value = itemDotsAt(timed.value, now / 1000)
  }
  const stop = (): void => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
  }
  watch(
    () => timed.value.length > 0,
    (moving) => {
      stop()
      if (moving) frame = requestAnimationFrame(tick)
      else dots.value = []
    },
    { immediate: true },
  )
  onBeforeUnmount(stop)
  return dots
}
