<script setup lang="ts">
// 3D表示。開いている設計図を描き、マウスの位置をブロック座標に直してツールに渡す。
// 左ドラッグで回す、右ドラッグで動かす、ホイールで拡大・縮小。動かさずに離したらクリック。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Blueprint } from '../../domain/blueprint'
import { isSingleCell } from '../../domain/box'
import { useSearchHighlight } from '../analysis/useSearchHighlight'
import { useDocumentSession } from '../document/documentSession'
import { useAppearanceStore } from '../stores/appearanceStore'
import { useBrushStore } from '../stores/brushStore'
import { useCalcStore } from '../stores/calcStore'
import { useProbeStore } from '../stores/probeStore'
import { useMeasureStore } from '../stores/measureStore'
import { usePasteStore } from '../stores/pasteStore'
import { usePortStore } from '../stores/portStore'
import { useToolStore } from '../stores/toolStore'
import { useViewStore } from '../stores/viewStore'
import { blockColor } from './blockColor'
import { BlueprintScene } from './blueprintScene'
import { CalcOverlay3D } from './calcOverlay3D'
import { RotationOverlay3D } from './rotationOverlay3D'
import { PortOverlay3D } from './portOverlay3D'
import { PasteOverlay3D } from './pasteOverlay3D'
import { SelectionOverlay3D } from './selectionOverlay3D'
import { createViewportRenderer, type SceneRenderer, type SceneRendererFactory } from './viewportRenderer'
import { currentThemeName, viewportTheme, watchThemeName } from './viewportTheme'

const props = withDefaults(
  defineProps<{
    /** 描画を作る関数。テストでは WebGL を使わない偽物を渡す */
    createRenderer?: SceneRendererFactory
  }>(),
  // 関数の props の既定値は、関数そのものを渡す
  { createRenderer: createViewportRenderer },
)

/** これより動いたらドラッグ（カメラの操作）とみなし、クリックにしない（CSS ピクセル） */
const CLICK_TOLERANCE = 4

const session = useDocumentSession()
const tools = useToolStore()
const view = useViewStore()
const brush = useBrushStore()
/** 検索で強調するブロックの位置（#15） */
const highlight = useSearchHighlight()
const calc = useCalcStore()
const probe = useProbeStore()
const measures = useMeasureStore()
const ports = usePortStore()
const paste = usePasteStore()
const appearance = useAppearanceStore()

const host = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const failure = ref<string | null>(null)

// 編集・元に戻すのたびに描き直す。設計図は同じオブジェクトのまま中身が変わるので、version も見る
const blueprintVersion = computed(() => ({
  blueprint: session.current.value?.blueprint ?? null,
  version: session.version.value,
}))

const scene = new BlueprintScene()
/** 置けない所の見本の色 */
const BLOCKED_GHOST_COLOR = 0xe0402a
// 計算結果の印（ネットワークの強調と問題の位置。#31）
const calcOverlay = new CalcOverlay3D()
scene.scene.add(calcOverlay.group)
// 回転の表示（#117）
const rotationOverlay = new RotationOverlay3D()
scene.scene.add(rotationOverlay.group)
// 仮の入出力の印（#70）
const portOverlay = new PortOverlay3D()
scene.scene.add(portOverlay.group)
// 選択範囲の箱の線（#130）
const selectionOverlay = new SelectionOverlay3D()
scene.scene.add(selectionOverlay.group)
// 貼り付けの見本（#133）
const pasteOverlay = new PasteOverlay3D()
scene.scene.add(pasteOverlay.group)
let renderer: SceneRenderer | null = null
let resizeObserver: ResizeObserver | null = null
let stopTheme: (() => void) | null = null
const stops: (() => void)[] = []

let shownBlueprint: Blueprint | null = null
let downAt: { x: number; y: number } | null = null

function render(): void {
  renderer?.requestRender()
}

function pickAt(e: PointerEvent | MouseEvent) {
  return renderer ? scene.pick(renderer.rayAt(e.clientX, e.clientY)) : null
}

function onPointerMove(e: PointerEvent): void {
  // ボタンを押している間はカメラの操作なので、マウスの下は調べない
  if (e.buttons !== 0) return
  tools.hover(pickAt(e))
}

function onPointerLeave(): void {
  tools.hover(null)
}

function onPointerDown(e: PointerEvent): void {
  downAt = e.button === 0 ? { x: e.clientX, y: e.clientY } : null
}

function onPointerUp(e: PointerEvent): void {
  const start = downAt
  downAt = null
  if (!start || e.button !== 0) return
  if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_TOLERANCE) return
  const target = pickAt(e)
  if (target) tools.click(target, { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey })
  // クリックで設計図が変わることがあるので、マウスの下を調べ直す
  tools.hover(pickAt(e))
}

onMounted(() => {
  scene.setTheme(viewportTheme(currentThemeName()))
  selectionOverlay.setTheme(viewportTheme(currentThemeName()))
  stopTheme = watchThemeName((name) => {
    scene.setTheme(viewportTheme(name))
    selectionOverlay.setTheme(viewportTheme(name))
    render()
  })

  try {
    renderer = props.createRenderer(canvas.value!, scene)
  } catch (e) {
    console.warn(e)
    failure.value =
      '3D表示を作れませんでした。このブラウザでは WebGL を使えないか、無効になっています。ブラウザの設定でハードウェアアクセラレーションを有効にするか、別のブラウザで開いてください。'
    return
  }
  renderer.onUserMove = () => view.cameraMoved()
  renderer.onHeadingChange = (x, z) => view.setCameraHeading(x, z)

  const el = host.value!
  renderer.resize(el.clientWidth, el.clientHeight)
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      if (!renderer) return
      renderer.resize(el.clientWidth, el.clientHeight)
      // マウスで動かす前なら、新しい縦横比で視点を合わせ直す（最初の大きさが決まる前に置いたときも）
      const size = scene.size
      if (size && view.cameraView) renderer.showView(view.cameraView, size)
    })
    resizeObserver.observe(el)
  }

  stops.push(
    // モデルとテクスチャで描くときの見た目（#84）。設計図より先に入れて、最初から1回で作る
    watch(
      () => appearance.active,
      (set) => {
        scene.setAppearances(set)
        render()
      },
      { immediate: true },
    ),
    watch(
      blueprintVersion,
      ({ blueprint: bp }) => {
        scene.setBlueprint(bp)
        // 別の設計図を開いたら、斜めから全体を見る
        if (bp && bp !== shownBlueprint) view.setView('iso')
        shownBlueprint = bp
        render()
      },
      { immediate: true },
    ),
    watch(
      () => view.cameraRequest,
      (req) => {
        const size = scene.size
        if (!req || !size || !renderer) return
        if (req.kind === 'fit') renderer.fitAll(size)
        else renderer.showView(req.kind, size)
      },
      { immediate: true },
    ),
    watch(
      () => view.layerDisplay,
      (d) => {
        scene.setLayerDisplay(d)
        render()
      },
      { immediate: true },
    ),
    watch(
      () => [view.showGrid, view.showAxes] as const,
      ([grid, axes]) => {
        scene.setGridVisible(grid)
        scene.setAxesVisible(axes)
        render()
      },
      { immediate: true },
    ),
    watch(
      highlight,
      (positions, before) => {
        if (positions === null && (before ?? null) === null) return
        scene.setHighlight(positions)
        render()
      },
      { immediate: true },
    ),
    watch(
      () => [tools.selectedPos, tools.selectionBox, tools.hoveredPos] as const,
      ([selected, box, hovered]) => {
        // 2つ以上のマスが入る範囲なら箱の線だけを出し、1つのブロックの枠は出さない（#130）
        const multi = box !== null && !isSingleCell(box)
        scene.setSelected(multi ? null : selected)
        scene.setHovered(hovered)
        selectionOverlay.update(box)
        render()
      },
      { immediate: true },
    ),
    // 置くツールの見本（#18）
    watch(
      () => [brush.ghostPos, brush.state, brush.ghostBlocked] as const,
      ([pos, state, blocked]) => {
        // 設置の規則で置けない所は赤（#121）
        scene.setGhost(pos, state ? (blocked ? BLOCKED_GHOST_COLOR : blockColor(state.id.toString())) : null)
        render()
      },
      { immediate: true },
    ),
    // 貼り付けの見本（#133）
    watch(
      () => [paste.cells, paste.box, paste.blocked] as const,
      ([cells, box, blocked]) => {
        pasteOverlay.update(cells, box, blocked)
        render()
      },
      { immediate: true },
    ),
    // 計算結果の印（#31）
    watch(
      () => [probe.networkPositions, calc.issuePositions, view.layerDisplay] as const,
      ([network, issues, display]) => {
        calcOverlay.update(network, issues, display)
        render()
      },
      { immediate: true },
    ),
    // 回転の表示（#117）。「回転」を切ったら出さない
    watch(
      () => [view.showRotation, calc.rotations, view.layerDisplay] as const,
      ([show, rotations, display]) => {
        rotationOverlay.update(show ? rotations : [], display)
        render()
      },
      { immediate: true },
    ),
    // 仮の入出力の印（#70）
    watch(
      () => [ports.ports, ports.selectedId, view.layerDisplay] as const,
      ([list, selected, display]) => {
        portOverlay.update(list, selected, display)
        render()
      },
      { immediate: true },
    ),
    // 計測とつながり（#16）
    watch(
      () => [measures.measurePoints, measures.connectGroup] as const,
      ([points, group]) => {
        scene.setMeasurePoints(points)
        scene.setConnectGroup(group?.positions ?? null)
        render()
      },
      { immediate: true },
    ),
  )
})

onBeforeUnmount(() => {
  for (const stop of stops) stop()
  stopTheme?.()
  resizeObserver?.disconnect()
  renderer?.dispose()
  renderer = null
  scene.dispose()
  calcOverlay.dispose()
  rotationOverlay.dispose()
  portOverlay.dispose()
  selectionOverlay.dispose()
  pasteOverlay.dispose()
  tools.hover(null)
})

defineExpose({ scene, calcOverlay, rotationOverlay, portOverlay, selectionOverlay, pasteOverlay })
</script>

<template>
  <div ref="host" class="viewport-3d" data-testid="viewport-3d">
    <canvas
      ref="canvas"
      aria-label="設計図の3D表示。左ドラッグで回す、右ドラッグで動かす、ホイールで拡大・縮小"
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
      @pointerdown="onPointerDown"
      @pointerup="onPointerUp"
      @contextmenu.prevent
    ></canvas>
    <p v-if="failure" class="failure" role="alert">{{ failure }}</p>
  </div>
</template>

<style scoped>
.viewport-3d {
  position: absolute;
  inset: 0;
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}

.failure {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  margin: 0;
  padding: 24px;
  text-align: center;
}
</style>
