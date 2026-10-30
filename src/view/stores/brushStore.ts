// 今の「置くブロック」（BlockBrush）。置くツール（#18）とスポイトが使う。
// R / Shift+R で回し、回せる向きがなければそう表示する。
// Modpack を読んでいれば、ブロック状態の定義から読んだ取りうる値の範囲で回す（#27）。

import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef, watch } from 'vue'
import type { BlockState } from '../../domain/blockState'
import type { Box } from '../../domain/box'
import type { Vec3 } from '../../domain/vec3'
import { BlockBrush } from '../../edit/blockBrush'
import { propertyValueOptionsFor } from '../../edit/orientationOptions'
import { useModpackContentStore } from './modpackContent'
import { useToolStore } from './toolStore'

/** 一直線に置く見本（#161） */
export interface LinePreview {
  /** 置くマス（空きマスだけ）と状態 */
  readonly cells: readonly { readonly pos: Vec3; readonly state: BlockState }[]
  /** 線の始点から終点までの箱 */
  readonly box: Box
}

export const NO_ROTATION_MESSAGE = 'このブロックには回せる向きがありません'

export const useBrushStore = defineStore('brush', () => {
  const content = useModpackContentStore()
  const tools = useToolStore()

  /** 置くブロック。まだ選んでいなければ null。BlockBrush は画面の状態ではないので markRaw で持つ */
  const brush = shallowRef<BlockBrush | null>(null)
  /** brush の中身が変わるたびに増える（BlockBrush.rotate は brush を作り直さないため） */
  const version = ref(0)
  /** 回せなかったときの知らせ（選択中のブロックを回したときも使う）。次の操作で消す */
  const message = ref<string | null>(null)
  /** 置くツールで、置くブロックの見本を出すマス（3D表示）。出さなければ null */
  const ghostPos = shallowRef<Vec3 | null>(null)
  /** 見本のマスに、設置の規則で置けないか（#121） */
  const ghostBlocked = ref(false)
  /** ドラッグで一直線に置くときの見本（#161）。置くマスと状態、線の端から端までの箱。出さなければ null */
  const linePreview = shallowRef<LinePreview | null>(null)

  /** 置くブロックの状態。画面ではこれを読む */
  const state = computed<BlockState | null>(() => {
    void version.value
    return brush.value?.state ?? null
  })

  /** ブロックの状態を置くブロックにする（スポイト、ブロック一覧からの選択） */
  function setFromBlock(next: BlockState | null): void {
    brush.value = next ? markRaw(BlockBrush.fromBlock(next, content.pack)) : null
    message.value = null
    version.value++
  }

  /**
   * R（水平）/ Shift+R（縦）で回す。回ったら true。
   * 置くブロックがあって回せる向きがなければ、知らせを出して false を返す。
   */
  function rotate(vertical: boolean): boolean {
    const b = brush.value
    if (!b) return false
    if (!b.rotate(vertical)) {
      message.value = NO_ROTATION_MESSAGE
      return false
    }
    message.value = null
    version.value++
    return true
  }

  /** 知らせを出す・消す（選択中のブロックを回したとき） */
  function setMessage(next: string | null): void {
    message.value = next
  }

  /** 置くブロックの見本を出すマスを変える（置くツールから呼ぶ）。blocked なら置けない所（赤く出す。#121） */
  function setGhost(pos: Vec3 | null, blocked = false): void {
    ghostPos.value = pos
    ghostBlocked.value = pos !== null && blocked
  }

  /** 一直線に置く見本を変える（置くツールのドラッグから呼ぶ）。null で消す */
  function setLinePreview(next: LinePreview | null): void {
    linePreview.value = next
  }

  // Modpack を読み終えた・外したら、取りうる値を読み直す
  watch(
    () => content.pack,
    (pack) => {
      const b = brush.value
      if (b) b.options = propertyValueOptionsFor(pack, b.state.id)
    },
  )

  // 選択が変わったら、前のブロックについての知らせは消す。
  // 選択を変えた操作がすぐ後に出す知らせ（範囲を動かしたときの座標のずれ）を消さないよう、その場で消す
  watch(
    () => tools.selectedPos,
    () => {
      message.value = null
    },
    { flush: 'sync' },
  )

  return { state, message, ghostPos, ghostBlocked, linePreview, setFromBlock, rotate, setMessage, setGhost, setLinePreview }
})
