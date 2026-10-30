// 計測ツール（M）と同じブロックツール（S）の結果。docs/ui.md「ツール」「2D表示と計測」。
// ストアを作ると2つのツールを toolStore に登録する。3D/2D表示と左下の結果の表示がここを読む。

import { defineStore } from 'pinia'
import { computed, markRaw, shallowRef, watch } from 'vue'
import { floodSameState } from '../../analysis/floodSameState'
import { measure, type Measurement } from '../../analysis/measure'
import type { BlockState } from '../../domain/blockState'
import type { Vec3 } from '../../domain/vec3'
import { useDocumentSession } from '../document/documentSession'
import { SameBlockTool } from '../tools/sameBlockTool'
import { MeasureTool } from '../tools/measureTool'
import { useToolStore } from './toolStore'

/** 同じブロックツールで強調しているまとまり */
export interface SameBlockGroup {
  /** クリックしたブロック */
  readonly start: Vec3
  /** まとまりのブロック状態 */
  readonly state: BlockState
  /** まとまりのブロック（先頭は start） */
  readonly positions: readonly Vec3[]
}

export const useMeasureStore = defineStore('measure', () => {
  const session = useDocumentSession()
  const tools = useToolStore()

  /** 計測ツールで選んだ点（0〜2個） */
  const measurePoints = shallowRef<readonly Vec3[]>([])
  /** 同じブロックツールでクリックしたブロック。なければ null */
  const sameBlockStart = shallowRef<Vec3 | null>(null)

  /** 2点そろったときの計測の結果 */
  const measurement = computed<Measurement | null>(() => {
    const [a, b] = measurePoints.value
    return a && b ? measure(a, b) : null
  })

  /** 強調しているまとまり。編集・元に戻すのあとは求め直す。始めのブロックが消えたら null */
  const sameBlockGroup = computed<SameBlockGroup | null>(() => {
    // 設計図は同じオブジェクトのまま中身が変わるので、version を読む
    void session.version.value
    const bp = session.current.value?.blueprint ?? null
    const start = sameBlockStart.value
    if (!bp || !start) return null
    const state = bp.get(start)
    if (!state) return null
    return markRaw({ start, state, positions: floodSameState(bp, start) })
  })

  function setMeasurePoints(points: readonly Vec3[]): void {
    measurePoints.value = points
  }

  function setSameBlockStart(pos: Vec3 | null): void {
    sameBlockStart.value = pos
  }

  const measureTool = new MeasureTool({ setMeasurePoints })
  tools.register(new SameBlockTool({ setSameBlockStart }))
  tools.register(measureTool)

  // 別の設計図を開いたら、計測と同じブロックを消す
  watch(
    () => session.current.value?.blueprint ?? null,
    (next, prev) => {
      if (next === prev) return
      measureTool.reset()
      setSameBlockStart(null)
    },
    // 開いた直後のクリックを消さないように、開いたその場で消す
    { flush: 'sync' },
  )

  return { measurePoints, measurement, sameBlockStart, sameBlockGroup, setMeasurePoints, setSameBlockStart }
})
