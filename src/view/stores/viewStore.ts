import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { LayerDisplay, LayerMode } from '../layers/layerDisplay'
import type { CameraView } from '../viewport/cameraViews'
import { useLayerStore } from './layerStore'

/** 視点の操作。ボタンを押すたびに seq が増えるので、同じ視点をもう一度押しても動く */
/** 表示部分に出す表示 */
export type ViewMode = '3d' | '2d'

export interface CameraRequest {
  readonly kind: CameraView | 'fit'
  readonly seq: number
}

/**
 * 表示の状態。docs/design.md の ViewState のうち、表示に関わる部分（ツールは toolStore）。
 * - 3D/2D の切り替え、2D表示の略称（#14）
 * - 視点、グリッド・座標軸の表示（#9）
 * - 段の表示方法、段ごとの非表示（#10。3D表示は layerDisplay を見て、メッシュを作り直さずに切り替える）
 * 今の段は layerStore（useLayerStore().current）が持つ。layerDisplay はそれと合わせた値
 */
export const useViewStore = defineStore('view', () => {
  /** 表示部分に出す表示。最初は 3D */
  const mode = ref<ViewMode>('3d')
  /** 2D表示で、マスが大きいときにブロックの略称を出す */
  const showLabels = ref(true)

  /** 今の視点。マウスで動かしたら null（どのボタンも押されていない） */
  const cameraView = ref<CameraView | null>('iso')
  /** 3D表示に送る視点の操作。最初は null */
  const cameraRequest = shallowRef<CameraRequest | null>(null)
  let seq = 0

  const showGrid = ref(true)
  const showAxes = ref(false)
  /** 計算で回るとしたブロックを、速さの段階で色分けする（docs/ui.md「回転の表示」） */
  const showRotation = ref(false)

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

  function setMode(next: ViewMode): void {
    mode.value = next
  }

  function setLabels(visible: boolean): void {
    showLabels.value = visible
  }

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

  /**
   * 3D のカメラが向いている水平の向き [x, z]（長さは問わない）。矢印キーで範囲を動かす向きに使う。
   * 毎フレーム変わりうるのでリアクティブにしない
   */
  let cameraHeading: readonly [number, number] = [-1, -1]
  function setCameraHeading(x: number, z: number): void {
    cameraHeading = [x, z]
  }
  function getCameraHeading(): readonly [number, number] {
    return cameraHeading
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

  function setRotation(visible: boolean): void {
    showRotation.value = visible
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

  /** 非表示の段をまとめて入れ替える（設計図を開き直したときなど） */
  function setHiddenLayers(hidden: ReadonlySet<number>): void {
    hiddenLayers.value = new Set(hidden)
  }

  return {
    mode,
    showLabels,
    setMode,
    setLabels,
    cameraView,
    cameraRequest,
    showGrid,
    showAxes,
    showRotation,
    setRotation,
    layerMode,
    hiddenLayers,
    layerDisplay,
    setView,
    fitAll,
    cameraMoved,
    setCameraHeading,
    getCameraHeading,
    setGrid,
    toggleGrid,
    setAxes,
    setLayerMode,
    setLayerHidden,
    setHiddenLayers,
  }
})
