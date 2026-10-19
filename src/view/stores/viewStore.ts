import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { LayerDisplay, LayerMode } from '../layers/layerDisplay'
import type { CameraView } from '../viewport/cameraViews'
import { useLayerStore } from './layerStore'

/** 視点の操作。ボタンを押すたびに seq が増えるので、同じ視点をもう一度押しても動く */
export interface CameraRequest {
  readonly kind: CameraView | 'fit'
  readonly seq: number
}

/**
 * 表示の状態。docs/design.md の ViewState のうち、表示に関わる部分（ツールは toolStore）。
 * - 視点、グリッド・座標軸の表示（#9）
 * - 段の表示方法、段ごとの非表示（画面は #10。3D表示は layerDisplay を見て描き直す）
 * 今の段は layerStore（useLayerStore().current）が持つ。layerDisplay はそれと合わせた値
 */
export const useViewStore = defineStore('view', () => {
  /** 今の視点。マウスで動かしたら null（どのボタンも押されていない） */
  const cameraView = ref<CameraView | null>('iso')
  /** 3D表示に送る視点の操作。最初は null */
  const cameraRequest = shallowRef<CameraRequest | null>(null)
  let seq = 0

  const showGrid = ref(true)
  const showAxes = ref(false)

  const layers = useLayerStore()
  const layerMode = ref<LayerMode>('all')
  /** 非表示にした段（y）。変えるときは Set を作り直す */
  const hiddenLayers = shallowRef<ReadonlySet<number>>(new Set())

  /** 3D/2D表示が使う段の表示方法 */
  const layerDisplay = computed<LayerDisplay>(() => ({
    layer: layers.current,
    mode: layerMode.value,
    hidden: hiddenLayers.value,
  }))

  function request(kind: CameraView | 'fit'): void {
    cameraRequest.value = { kind, seq: ++seq }
  }

  /** 視点を切り替える（斜め・上・正面・横） */
  function setView(view: CameraView): void {
    cameraView.value = view
    request(view)
  }

  /** 今の向きのまま、設計図全体が入るようにする */
  function fitAll(): void {
    request('fit')
  }

  /** マウスでカメラを動かしたとき（3D表示から呼ぶ） */
  function cameraMoved(): void {
    cameraView.value = null
  }

  function setGrid(visible: boolean): void {
    showGrid.value = visible
  }

  function toggleGrid(): void {
    showGrid.value = !showGrid.value
  }

  function setAxes(visible: boolean): void {
    showAxes.value = visible
  }

  function setLayerMode(mode: LayerMode): void {
    layerMode.value = mode
  }

  function setLayerHidden(y: number, hidden: boolean): void {
    if (hiddenLayers.value.has(y) === hidden) return
    const next = new Set(hiddenLayers.value)
    if (hidden) next.add(y)
    else next.delete(y)
    hiddenLayers.value = next
  }

  /** すべての段を表示する（非表示を解除し、表示方法を「すべて」にする） */
  function showAllLayers(): void {
    hiddenLayers.value = new Set()
    layerMode.value = 'all'
  }

  return {
    cameraView,
    cameraRequest,
    showGrid,
    showAxes,
    layerMode,
    hiddenLayers,
    layerDisplay,
    setView,
    fitAll,
    cameraMoved,
    setGrid,
    toggleGrid,
    setAxes,
    setLayerMode,
    setLayerHidden,
    showAllLayers,
  }
})
