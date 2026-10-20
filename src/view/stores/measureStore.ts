// 計測ツール（M）とつながりツール（C）の結果。docs/ui.md「ツール」「2D表示と計測」。
// ストアを作ると2つのツールを toolStore に登録する。3D/2D表示と左下の結果の表示がここを読む。

import { defineStore } from 'pinia'
import { computed, markRaw, shallowRef, watch } from 'vue'
import { floodSameState } from '../../analysis/floodSameState'
import { measure, type Measurement } from '../../analysis/measure'
import type { BlockState } from '../../domain/blockState'
import type { Vec3 } from '../../domain/vec3'
import { useDocumentSession } from '../document/documentSession'
import { ConnectTool } from '../tools/connectTool'
import { MeasureTool } from '../tools/measureTool'
import { useToolStore } from './toolStore'

/** つながりツールで強調しているまとまり */
export interface ConnectGroup {
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
  /** つながりツールでクリックしたブロック。なければ null */
  const connectStart = shallowRef<Vec3 | null>(null)

  /** 2点そろったときの計測の結果 */
  const measurement = computed<Measurement | null>(() => {
    const [a, b] = measurePoints.value
    return a && b ? measure(a, b) : null
  })

  /** 強調しているまとまり。編集・元に戻すのあとは求め直す。始めのブロックが消えたら null */
  const connectGroup = computed<ConnectGroup | null>(() => {
    // 設計図は同じオブジェクトのまま中身が変わるので、version を読む
    void session.version.value
    const bp = session.current.value?.blueprint ?? null
    const start = connectStart.value
    if (!bp || !start) return null
    const state = bp.get(start)
    if (!state) return null
    return markRaw({ start, state, positions: floodSameState(bp, start) })
  })

  function setMeasurePoints(points: readonly Vec3[]): void {
    measurePoints.value = points
  }

  function setConnectStart(pos: Vec3 | null): void {
    connectStart.value = pos
  }

  const measureTool = new MeasureTool({ setMeasurePoints })
  tools.register(new ConnectTool({ setConnectStart }))
  tools.register(measureTool)

  // 別の設計図を開いたら、計測とつながりを消す
  watch(
    () => session.current.value?.blueprint ?? null,
    (next, prev) => {
      if (next === prev) return
      measureTool.reset()
      setConnectStart(null)
    },
    // 開いた直後のクリックを消さないように、開いたその場で消す
    { flush: 'sync' },
  )

  return { measurePoints, measurement, connectStart, connectGroup, setMeasurePoints, setConnectStart }
})
