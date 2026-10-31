<script setup lang="ts">
// 3D表示。開いている設計図を描き、マウスの位置をブロック座標に直してツールに渡す。
// 左ドラッグで回す、右ドラッグで動かす、ホイールで拡大・縮小。動かさずに離したらクリック。
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { Blueprint } from '../../domain/blueprint'
import { boxContains, isSingleCell } from '../../domain/box'
import type { Vec3 } from '../../domain/vec3'
import { useSearchHighlight } from '../analysis/useSearchHighlight'
import { useDocumentSession } from '../document/documentSession'
import { axisParam, planeHit } from '../edit/dragMove'
import { useDragMove } from '../edit/useDragMove'
import { faceCenter, hitHandle3D, type FaceHandle } from '../edit/rangeHandles'
import { useRangeResize } from '../edit/useRangeResize'
import { frameBox, hitFrameHandle3D } from '../edit/frameHandles'
import { frameHandlesAllowed, useFrameResize } from '../edit/useFrameResize'
import { useBlueprintResizeStore } from '../stores/blueprintResizeStore'
import { useDragMoveStore } from '../stores/dragMoveStore'
import { useAppearanceStore } from '../stores/appearanceStore'
import { useBrushStore } from '../stores/brushStore'
import { useCalcStore } from '../stores/calcStore'
import { useProbeStore } from '../stores/probeStore'
import { useMeasureStore } from '../stores/measureStore'
import { usePasteStore } from '../stores/pasteStore'
import { usePortStore } from '../stores/portStore'
import { useToolStore } from '../stores/toolStore'
import { useViewStore } from '../stores/viewStore'
import type { PickModifiers, PickTarget } from '../tools/tool'
import SelectionToolbar from '../selection/SelectionToolbar.vue'
import { boundingRect, sameRect, type ScreenRect } from '../selection/toolbarPosition'
import { blockColor } from './blockColor'
import { BlueprintScene } from './blueprintScene'
import { CalcOverlay3D } from './calcOverlay3D'
import { RotationOverlay3D } from './rotationOverlay3D'
import { PortOverlay3D } from './portOverlay3D'
import { PasteOverlay3D } from './pasteOverlay3D'
import { SelectionOverlay3D } from './selectionOverlay3D'
import { FrameOverlay3D } from './frameOverlay3D'
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
const dragMove = useDragMove()
const rangeResize = useRangeResize()
const frameResize = useFrameResize()
const resizeStore = useBlueprintResizeStore()
const dragMoveStore = useDragMoveStore()

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
// 設計図の枠の取っ手と、変えたあとの枠（#201）
const frameOverlay = new FrameOverlay3D()
scene.scene.add(frameOverlay.group)
// 貼り付けの見本（#133）
const pasteOverlay = new PasteOverlay3D()
scene.scene.add(pasteOverlay.group)
// 置くツールで一直線に置く見本（#161）。貼り付けの見本と同じ形で出す
const lineOverlay = new PasteOverlay3D()
scene.scene.add(lineOverlay.group)
// 範囲をつかんで動かす見本（#199）。貼り付けの見本と同じ形で出す
const moveOverlay = new PasteOverlay3D()
scene.scene.add(moveOverlay.group)
let renderer: SceneRenderer | null = null
let resizeObserver: ResizeObserver | null = null
let stopTheme: (() => void) | null = null
const stops: (() => void)[] = []

let shownBlueprint: Blueprint | null = null
let downAt: { x: number; y: number } | null = null

function render(): void {
  renderer?.requestRender()
}

/** 範囲のツールバー（#160）を置くための、選択範囲の箱が画面で占める長方形。カメラが動くたびに求め直す */
const selectionRect = shallowRef<ScreenRect | null>(null)
const viewWidth = ref(0)
const viewHeight = ref(0)

function updateSelectionRect(): void {
  const box = tools.selectionBox
  const project = renderer?.projectToScreen?.bind(renderer)
  let next: ScreenRect | null = null
  if (box && project && !isSingleCell(box)) {
    const points: [number, number][] = []
    for (const x of [box.min[0], box.max[0] + 1])
      for (const y of [box.min[1], box.max[1] + 1])
        for (const z of [box.min[2], box.max[2] + 1]) {
          const p = project([x, y, z])
          if (p) points.push(p)
        }
    next = boundingRect(points)
  }
  if (!sameRect(next, selectionRect.value)) selectionRect.value = next
  viewWidth.value = host.value?.clientWidth ?? 0
  viewHeight.value = host.value?.clientHeight ?? 0
}

function pickAt(e: PointerEvent | MouseEvent) {
  return renderer ? scene.pick(renderer.rayAt(e.clientX, e.clientY)) : null
}

/**
 * 置くツールのドラッグ（#161）。ブロックか床を押したら、カメラを回さずに一直線に引く。
 * 少し動いたら始め、動かずに離したときはふつうのクリック。refused はツールが受け取らなかった（置くブロックがない など）
 */
interface PlaceDrag {
  readonly pointerId: number
  readonly target: PickTarget
  begun: boolean
  refused: boolean
}
let placeDrag: PlaceDrag | null = null

/**
 * 範囲をつかんで動かすドラッグ（#199）。範囲の中のブロックを押したら、カメラを回さずに動かす。
 * 押したブロックの真ん中の高さの水平な面の上で動かし、Shift の間は押した点を通る縦の線の上で動かす。
 * 少し動いたら始め、動かずに離したときはふつうのクリック
 */
interface MoveDrag {
  readonly pointerId: number
  /** 押したブロックの真ん中 */
  readonly grab: Vec3
  begun: boolean
  offset: Vec3
}
let moveDrag: MoveDrag | null = null

/** つかんだ点からのずれ（マス）。求められなければ前のまま */
function moveOffset(e: PointerEvent, drag: MoveDrag): Vec3 {
  if (!renderer) return drag.offset
  const ray = renderer.rayAt(e.clientX, e.clientY)
  if (e.shiftKey) {
    const s = axisParam(ray, drag.grab, 1)
    return s === null ? drag.offset : [0, Math.round(s), 0]
  }
  const hit = planeHit(ray, drag.grab[1])
  return hit === null ? drag.offset : [Math.round(hit[0] - drag.grab[0]), 0, Math.round(hit[1] - drag.grab[2])]
}

/**
 * 範囲の取っ手を引くドラッグ（#200）。つかんだ面の真ん中を通り、面の向きに沿った直線の上で動かす。
 * 押したらすぐ始め、離してもクリックにしない
 */
interface ResizeDrag {
  readonly pointerId: number
  readonly face: FaceHandle
  /** つかんだときの面の真ん中 */
  readonly center: Vec3
}
let resizeDrag: ResizeDrag | null = null

/** 範囲の取っ手を出すか（#200）。選択ツールで2つ以上のマスが入る範囲を選び、貼り付けの見本がないとき */
function handlesShown(): boolean {
  const box = tools.selectionBox
  return tools.activeToolId === 'select' && box !== null && !isSingleCell(box) && !paste.active
}

/** 取っ手を押したらつかむ。つかんだら true */
function grabHandle(e: PointerEvent): boolean {
  const box = tools.selectionBox
  if (!renderer || !box || !handlesShown()) return false
  const face = hitHandle3D(renderer.rayAt(e.clientX, e.clientY), box)
  if (!face || !rangeResize.begin([face])) return false
  resizeDrag = { pointerId: e.pointerId, face, center: faceCenter(box, face) }
  renderer.setOrbitEnabled?.(false)
  try {
    canvas.value?.setPointerCapture?.(e.pointerId)
  } catch {
    // 捕まえられなくても、ドラッグはできる
  }
  return true
}

function updateResize(e: PointerEvent, drag: ResizeDrag): void {
  if (!renderer) return
  const s = axisParam(renderer.rayAt(e.clientX, e.clientY), drag.center, drag.face.axis)
  // 面の向きと視線が平行なときは動かさない
  if (s === null) return
  rangeResize.update(() => drag.center[drag.face.axis] + s)
}

/**
 * 設計図の枠の取っ手を引くドラッグ（#201）。範囲の取っ手と同じく、面の向きの直線に沿って動かす。
 * 離したら大きさを変える（消えるものがあれば画面を開く）
 */
interface FrameDrag {
  readonly pointerId: number
  readonly face: FaceHandle
  readonly center: Vec3
}
let frameDrag: FrameDrag | null = null

/** 枠の取っ手を出すか（#201）。選択ツールで、リージョンが1つの設計図を開き、貼り付けの見本がないとき */
function frameHandlesShown(): boolean {
  const bp = session.current.value?.blueprint
  return tools.activeToolId === 'select' && !!bp && frameHandlesAllowed(bp.regions.length) && !paste.active
}

function grabFrameHandle(e: PointerEvent): boolean {
  const bp = session.current.value?.blueprint
  if (!renderer || !bp || !frameHandlesShown()) return false
  const face = hitFrameHandle3D(renderer.rayAt(e.clientX, e.clientY), bp.size)
  if (!face || !frameResize.begin(face)) return false
  frameDrag = { pointerId: e.pointerId, face, center: faceCenter(frameBox(bp.size), face) }
  renderer.setOrbitEnabled?.(false)
  try {
    canvas.value?.setPointerCapture?.(e.pointerId)
  } catch {
    // 捕まえられなくても、ドラッグはできる
  }
  return true
}

function updateFrameDrag(e: PointerEvent, drag: FrameDrag): void {
  if (!renderer) return
  const s = axisParam(renderer.rayAt(e.clientX, e.clientY), drag.center, drag.face.axis)
  if (s === null) return
  frameResize.update(drag.center[drag.face.axis] + s)
}

function releaseFrameDrag(e: PointerEvent): void {
  frameDrag = null
  renderer?.setOrbitEnabled?.(true)
  try {
    if (canvas.value?.hasPointerCapture?.(e.pointerId)) canvas.value.releasePointerCapture(e.pointerId)
  } catch {
    // 放せなくても困らない
  }
}

function finishResizeDrag(e: PointerEvent): void {
  resizeDrag = null
  rangeResize.end()
  renderer?.setOrbitEnabled?.(true)
  try {
    if (canvas.value?.hasPointerCapture?.(e.pointerId)) canvas.value.releasePointerCapture(e.pointerId)
  } catch {
    // 放せなくても困らない
  }
}

function modsOf(e: PointerEvent | MouseEvent): PickModifiers {
  return { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey }
}

function onPointerMove(e: PointerEvent): void {
  if (resizeDrag && resizeDrag.pointerId === e.pointerId) {
    updateResize(e, resizeDrag)
    return
  }
  if (frameDrag && frameDrag.pointerId === e.pointerId) {
    updateFrameDrag(e, frameDrag)
    return
  }
  if (moveDrag && moveDrag.pointerId === e.pointerId) {
    const start = downAt
    if (!moveDrag.begun && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_TOLERANCE) {
      moveDrag.begun = dragMove.begin()
    }
    if (moveDrag.begun) {
      moveDrag.offset = moveOffset(e, moveDrag)
      dragMove.update(moveDrag.offset, modsOf(e))
    }
    return
  }
  if (placeDrag && placeDrag.pointerId === e.pointerId) {
    const start = downAt
    if (!placeDrag.begun && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_TOLERANCE) {
      placeDrag.begun = true
      placeDrag.refused = !tools.beginDrag(placeDrag.target, modsOf(e))
    }
    if (placeDrag.begun && !placeDrag.refused) tools.dragTo(pickAt(e))
    return
  }
  // ボタンを押している間はカメラの操作なので、マウスの下は調べない
  if (e.buttons !== 0) return
  tools.hover(pickAt(e))
  const ray = renderer?.rayAt(e.clientX, e.clientY) ?? null
  const size = session.current.value?.blueprint.size ?? null
  const onHandle =
    ray !== null &&
    ((handlesShown() && hitHandle3D(ray, tools.selectionBox!) !== null) || (frameHandlesShown() && size !== null && hitFrameHandle3D(ray, size) !== null))
  if (canvas.value) canvas.value.style.cursor = onHandle ? 'pointer' : ''
}

function onPointerLeave(): void {
  if (placeDrag || moveDrag || resizeDrag || frameDrag) return
  tools.hover(null)
}

/** 置くツールのドラッグを終える。カメラの操作を戻す */
function finishPlaceDrag(e: PointerEvent): void {
  placeDrag = null
  renderer?.setOrbitEnabled?.(true)
  try {
    if (canvas.value?.hasPointerCapture?.(e.pointerId)) canvas.value.releasePointerCapture(e.pointerId)
  } catch {
    // 放せなくても困らない
  }
}

/** 範囲を動かすドラッグを終える。カメラの操作を戻す */
function finishMoveDrag(e: PointerEvent): void {
  moveDrag = null
  renderer?.setOrbitEnabled?.(true)
  try {
    if (canvas.value?.hasPointerCapture?.(e.pointerId)) canvas.value.releasePointerCapture(e.pointerId)
  } catch {
    // 放せなくても困らない
  }
}

/** 選択ツールで、範囲の中のブロックを押したら範囲をつかむ（#199）。つかんだら true */
function grabSelection(e: PointerEvent): boolean {
  const box = tools.selectionBox
  // 1マスだけのとき（クリックで選んだブロック）は、今までどおりカメラを回す
  if (tools.activeToolId !== 'select' || !box || isSingleCell(box) || paste.active) return false
  const target = pickAt(e)
  if (!target || target.empty || !boxContains(box, target.pos)) return false
  const [x, y, z] = target.pos
  moveDrag = { pointerId: e.pointerId, grab: [x + 0.5, y + 0.5, z + 0.5], begun: false, offset: [0, 0, 0] }
  renderer?.setOrbitEnabled?.(false)
  try {
    canvas.value?.setPointerCapture?.(e.pointerId)
  } catch {
    // 捕まえられなくても、ドラッグはできる
  }
  return true
}

function onPointerDown(e: PointerEvent): void {
  downAt = e.button === 0 ? { x: e.clientX, y: e.clientY } : null
  placeDrag = null
  moveDrag = null
  resizeDrag = null
  frameDrag = null
  // 取っ手は範囲をつかむより先に当たる（#200）。範囲の取っ手、枠の取っ手（#201）の順
  if (e.button === 0 && (grabHandle(e) || grabFrameHandle(e) || grabSelection(e))) return
  if (e.button !== 0 || tools.activeToolId !== 'place' || paste.active) return
  const target = pickAt(e)
  if (!target) return
  // OrbitControls より先に呼ばれるので、ここで止めればカメラは回らない
  placeDrag = { pointerId: e.pointerId, target, begun: false, refused: false }
  renderer?.setOrbitEnabled?.(false)
  try {
    canvas.value?.setPointerCapture?.(e.pointerId)
  } catch {
    // 捕まえられなくても、ドラッグはできる
  }
}

function onPointerCancel(e: PointerEvent): void {
  if (frameDrag) {
    frameResize.cancel()
    releaseFrameDrag(e)
    downAt = null
    return
  }
  if (resizeDrag) {
    finishResizeDrag(e)
    downAt = null
    return
  }
  if (moveDrag) {
    dragMove.cancel()
    finishMoveDrag(e)
    downAt = null
    return
  }
  if (!placeDrag) return
  if (placeDrag.begun && !placeDrag.refused) tools.cancelDrag()
  finishPlaceDrag(e)
  downAt = null
}

function onPointerUp(e: PointerEvent): void {
  const framing = frameDrag
  if (framing && framing.pointerId === e.pointerId) {
    updateFrameDrag(e, framing)
    releaseFrameDrag(e)
    downAt = null
    frameResize.finish()
    tools.hover(pickAt(e))
    return
  }
  const resizing = resizeDrag
  if (resizing && resizing.pointerId === e.pointerId) {
    updateResize(e, resizing)
    finishResizeDrag(e)
    downAt = null
    tools.hover(pickAt(e))
    return
  }
  const grabbed = moveDrag
  if (grabbed && grabbed.pointerId === e.pointerId) {
    finishMoveDrag(e)
    if (grabbed.begun) {
      downAt = null
      dragMove.finish(moveOffset(e, grabbed), modsOf(e))
      tools.hover(pickAt(e))
      return
    }
  }
  const drag = placeDrag
  if (drag && drag.pointerId === e.pointerId) {
    finishPlaceDrag(e)
    if (drag.begun) {
      downAt = null
      if (!drag.refused) tools.endDrag(pickAt(e), modsOf(e))
      tools.hover(pickAt(e))
      return
    }
  }
  const start = downAt
  downAt = null
  if (!start || e.button !== 0) return
  if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_TOLERANCE) return
  const target = pickAt(e)
  if (target) tools.click(target, modsOf(e))
  // クリックで設計図が変わることがあるので、マウスの下を調べ直す
  tools.hover(pickAt(e))
}

onMounted(() => {
  scene.setTheme(viewportTheme(currentThemeName()))
  selectionOverlay.setTheme(viewportTheme(currentThemeName()))
  frameOverlay.setTheme(viewportTheme(currentThemeName()))
  stopTheme = watchThemeName((name) => {
    scene.setTheme(viewportTheme(name))
    selectionOverlay.setTheme(viewportTheme(name))
    frameOverlay.setTheme(viewportTheme(name))
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
  renderer.onRender = updateSelectionRect

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
    // 設計図の枠の取っ手（#201）
    watch(
      () => [tools.activeToolId, blueprintVersion.value, paste.active] as const,
      () => {
        frameOverlay.setHandles(frameHandlesShown() ? (session.current.value?.blueprint.size ?? null) : null)
        render()
      },
      { immediate: true },
    ),
    watch(
      () => resizeStore.preview,
      (preview) => {
        frameOverlay.setPreview(preview)
        render()
      },
      { immediate: true },
    ),
    // 範囲の取っ手（#200）
    watch(
      () => [tools.activeToolId, tools.selectionBox, paste.active] as const,
      () => {
        selectionOverlay.setHandlesVisible(handlesShown())
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
    // 一直線に置く見本（#161）
    watch(
      () => brush.linePreview,
      (line) => {
        lineOverlay.update(line?.cells ?? [], line?.box ?? null, false)
        render()
      },
      { immediate: true },
    ),
    // 範囲をつかんで動かす見本（#199）
    watch(
      () => dragMoveStore.preview,
      (preview) => {
        moveOverlay.update(preview?.cells ?? [], preview?.box ?? null, (preview?.blocked ?? 0) > 0)
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
    // 計測と同じブロック（#16）
    watch(
      () => [measures.measurePoints, measures.sameBlockGroup] as const,
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
  frameOverlay.dispose()
  pasteOverlay.dispose()
  lineOverlay.dispose()
  moveOverlay.dispose()
  tools.hover(null)
})

defineExpose({ scene, calcOverlay, rotationOverlay, portOverlay, selectionOverlay, pasteOverlay, frameOverlay })
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
      @pointercancel="onPointerCancel"
      @contextmenu.prevent
    ></canvas>
    <!-- 範囲のツールバー（#160） -->
    <SelectionToolbar :rect="selectionRect" :view-width="viewWidth" :view-height="viewHeight" />
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
