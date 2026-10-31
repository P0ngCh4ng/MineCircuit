<script setup lang="ts">
// 2D表示（LayerView2D）。今の段を真上から見たマス目で描く。docs/ui.md「2D表示と計測」。
// マウスの位置は picker.ts の pick2D でマスに直し、toolStore を通して今のツールに渡す。
// ホイールで拡大・縮小、中ボタンか空白キー＋左ドラッグで表示を動かす（#155。計算は view2D.ts）。
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { boxContains, isSingleCell } from '../../domain/box'
import { useSearchHighlight } from '../analysis/useSearchHighlight'
import { useDocumentSession } from '../document/documentSession'
import { useDragMove } from '../edit/useDragMove'
import { useSelectConnected } from '../edit/selectConnected'
import { edgeCursor2D, hitEdge2D, type FaceHandle } from '../edit/rangeHandles'
import { useRangeResize } from '../edit/useRangeResize'
import { useDragMoveStore } from '../stores/dragMoveStore'
import { useAppearanceStore } from '../stores/appearanceStore'
import { useBrushStore } from '../stores/brushStore'
import { useCalcStore } from '../stores/calcStore'
import { clampLayer, useLayerStore } from '../stores/layerStore'
import { useProbeStore } from '../stores/probeStore'
import { useMeasureStore } from '../stores/measureStore'
import { usePasteStore } from '../stores/pasteStore'
import { usePortStore } from '../stores/portStore'
import { useToolStore } from '../stores/toolStore'
import { useViewStore } from '../stores/viewStore'
import { useFlowTrace } from '../calc/useFlowTrace'
import SelectionToolbar from '../selection/SelectionToolbar.vue'
import type { ScreenRect } from '../selection/toolbarPosition'
import { pick2D, type GridLayout2D, type PickScene2D } from '../tools/picker'
import type { Vec3 } from '../../domain/vec3'
import type { PickModifiers, PickTarget } from '../tools/tool'
import { ANALYSIS_COLORS_2D, drawAnalysisOverlay2D } from './analysisOverlay2D'
import { clampedCell2D, dragSelectionBox, insideGrid2D, isDrag2D, type Cell2D } from './dragSelect2D'
import { layoutGrid2D } from './layerGrid2D'
import { drawPortOverlay2D } from './portOverlay2D'
import {
  DARK_THEME_2D,
  drawGrowMargin2D,
  drawLayer2D,
  drawPastePreview2D,
  drawSelectionBox2D,
  GROW_MARGIN_2D,
  LIGHT_THEME_2D,
} from './layerRenderer2D'
import { createTextureCellPainter } from './textureCellPainter2D'
import { clampToView, panBy, wheelZoomFactor, zoomAt } from './view2D'

const props = withDefaults(defineProps<{ showGrid?: boolean }>(), { showGrid: true })

const session = useDocumentSession()
const layers = useLayerStore()
const tools = useToolStore()
const viewMode = useViewStore()
const flow = useFlowTrace()
/** 検索で強調するブロックの位置（#15） */
const highlight = useSearchHighlight()
const calc = useCalcStore()
const probe = useProbeStore()
const measures = useMeasureStore()
const ports = usePortStore()
const paste = usePasteStore()
const brush = useBrushStore()
const dragMove = useDragMove()
const selectConnected = useSelectConnected()
const rangeResize = useRangeResize()
const dragMoveStore = useDragMoveStore()
const appearance = useAppearanceStore()
/** テクスチャで描く（#85）。色で描くとき、見た目がないときは null */
const cellPainter = computed(() => createTextureCellPainter(appearance.active))

const host = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
/** 表示の大きさ（CSS ピクセル） */
const width = ref(0)
const height = ref(0)
const dark = ref(false)
const blueprint = computed(() => {
  void session.version.value
  return session.current.value?.blueprint ?? null
})

/** 設計図の大きさ。範囲を動かすと変わるので、編集のたびに読み直す（blueprint は同じものなので変化を拾えない） */
const size = computed(() => {
  void session.version.value
  return session.current.value?.blueprint.size ?? null
})

/** 拡大・縮小や移動をしたあとのマス目の置き方。null なら全体を表示（#155） */
const zoomed = shallowRef<GridLayout2D | null>(null)

/** マス目の置き方。描くときと、マウスの位置をマスに直すときに使う */
const layout = computed<GridLayout2D | null>(() => {
  const s = size.value
  if (!s || width.value === 0 || height.value === 0) return null
  const z = zoomed.value
  // 表示の大きさが変わっても、マス目が外へ出きらないようにする
  return z ? clampToView(z, s, width.value, height.value) : layoutGrid2D(width.value, height.value, s)
})

// 別の設計図を開いたら、全体を表示に戻す
watch(
  () => session.current.value?.blueprint ?? null,
  () => {
    zoomed.value = null
  },
)

// 上のバーの視点の「全体を表示」（#155）
watch(
  () => viewMode.cameraRequest,
  (req) => {
    if (req?.kind === 'fit') zoomed.value = null
  },
)

/** 今の段（設計図の高さに収める） */
const layer = computed(() => {
  const s = size.value
  return s ? clampLayer(layers.current, s[1]) : 0
})

/** 範囲のツールバー（#160）を置くための、選択範囲の長方形（x・z。段によらない） */
const selectionRect = computed<ScreenRect | null>(() => {
  const box = tools.selectionBox
  const grid = layout.value
  if (!box || !grid) return null
  const { originX: ox, originY: oy, cellSize: cs } = grid
  return { left: ox + box.min[0] * cs, top: oy + box.min[2] * cs, right: ox + (box.max[0] + 1) * cs, bottom: oy + (box.max[2] + 1) * cs }
})

/** 範囲の辺を引けるか（#205）。選択ツールで2つ以上のマスが入る範囲を選び、範囲の段にいるとき */
function edgesActive(): boolean {
  const box = tools.selectionBox
  if (tools.activeToolId !== 'select' || !box || isSingleCell(box) || paste.active) return false
  return layer.value >= box.min[1] && layer.value <= box.max[1]
}

/** マウスの下の範囲の辺（角なら2つ）。なければ null */
function edgeAt(e: MouseEvent): readonly FaceHandle[] | null {
  const box = tools.selectionBox
  const grid = layout.value
  const p = canvasPoint(e)
  if (!box || !grid || !p || !edgesActive()) return null
  return hitEdge2D(p.x, p.y, grid, box)
}

/** 辺に重ねたときのカーソル */
const edgeCursor = ref<string | null>(null)

const layerLabel = computed(() => {
  const s = size.value
  return s ? `段 ${layer.value + 1} / ${s[1]}` : ''
})

function draw(): void {
  const el = canvas.value
  const bp = blueprint.value
  const grid = layout.value
  if (!el || !bp || !grid) return
  const ctx = el.getContext('2d')
  if (!ctx) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  el.width = Math.round(width.value * dpr)
  el.height = Math.round(height.value * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const theme = dark.value ? DARK_THEME_2D : LIGHT_THEME_2D
  const box = tools.selectionBox
  // 2つ以上のマスが入る範囲なら長方形だけを描き、1つのブロックの枠は出さない（#130）
  const multi = box !== null && !isSingleCell(box)
  drawLayer2D(ctx, width.value, height.value, {
    blueprint: bp,
    layer: layer.value,
    layout: grid,
    theme,
    showGrid: props.showGrid,
    showLabels: viewMode.showLabels,
    hovered: tools.hoverTarget?.pos ?? null,
    selected: multi ? null : tools.selectedPos,
    fontFamily: getComputedStyle(el).fontFamily || 'sans-serif',
    highlighted: highlight.value,
    calcMarks: { network: probe.networkPositions, issues: calc.issuePositions },
    rotations: viewMode.showRotation ? calc.rotations : null,
    flow: flow.value,
    cellPainter: cellPainter.value,
  })
  // 置くツールのとき、枠のすぐ外に置ける余白（#191）
  if (tools.activeToolId === 'place') drawGrowMargin2D(ctx, grid, bp.size, GROW_MARGIN_2D, theme)
  // 選択範囲の長方形。範囲の外の段では点線（#130）
  drawSelectionBox2D(ctx, grid, layer.value, box, theme)
  // 計測と同じブロック（#16）
  drawAnalysisOverlay2D(
    ctx,
    grid,
    layer.value,
    { measurePoints: measures.measurePoints, connectGroup: measures.sameBlockGroup?.positions ?? null },
    ANALYSIS_COLORS_2D[dark.value ? 'dark' : 'light'],
  )
  // 仮の入出力（#70）
  drawPortOverlay2D(ctx, grid, layer.value, ports.ports, ports.selectedId)
  // 貼り付けの見本（#133）
  drawPastePreview2D(
    ctx,
    grid,
    layer.value,
    paste.cells.map((c) => ({ pos: c.pos, id: c.state.id.toString() })),
    paste.box,
    paste.blocked,
  )
  // 範囲をつかんで動かす見本（#199）
  const moving = dragMoveStore.preview
  if (moving) {
    drawPastePreview2D(
      ctx,
      grid,
      layer.value,
      moving.cells.map((c) => ({ pos: c.pos, id: c.state.id.toString() })),
      moving.box,
      moving.blocked > 0,
    )
  }
  // 置くツールで一直線に置く見本（#161）
  const line = brush.linePreview
  if (line) {
    drawPastePreview2D(
      ctx,
      grid,
      layer.value,
      line.cells.map((c) => ({ pos: c.pos, id: c.state.id.toString() })),
      line.box,
      false,
    )
  }
}
// 一直線に置く見本が変わったら描き直す（#161）
watch(
  () => brush.linePreview,
  () => draw(),
  { flush: 'post' },
)
// 範囲をつかんで動かす見本が変わったら描き直す（#199）
watch(
  () => dragMoveStore.preview,
  () => draw(),
  { flush: 'post' },
)
// 貼り付けの見本が変わったら描き直す（#133）
watch(
  () => [paste.cells, paste.box, paste.blocked],
  () => draw(),
  { flush: 'post' },
)

// 見た目と「テクスチャ／色」が変わったら描き直す（#85）
watch(cellPainter, () => draw(), { flush: 'post' })

// 仮の入出力が変わったら描き直す（#70）
watch(
  () => [ports.ports, ports.selectedId],
  () => draw(),
  { flush: 'post' },
)

// 計算結果の印（ネットワークの強調と問題の位置。#31）と回転の表示（#117）が変わったら描き直す
watch(
  () => [probe.networkPositions, calc.issuePositions, viewMode.showRotation, calc.rotations, flow.value],
  () => draw(),
  { flush: 'post' },
)

// 計測と同じブロックが変わったら描き直す（#16）
watch(
  () => [measures.measurePoints, measures.sameBlockGroup],
  () => draw(),
  { flush: 'post' },
)

// 設計図・段・表示の設定・マウスの下・選択が変わったら描き直す
watch(
  () => [layout.value, session.version.value, layer.value, viewMode.showLabels, props.showGrid, tools.hoverTarget, tools.selectedPos, tools.selectionBox, tools.activeToolId, paste.active, dark.value, highlight.value],
  () => draw(),
  { flush: 'post' },
)

function pickAt(e: MouseEvent): PickTarget | null {
  const bp = blueprint.value
  const grid = layout.value
  const el = canvas.value
  if (!bp || !grid || !el) return null
  const rect = el.getBoundingClientRect()
  const scene: PickScene2D = {
    size: bp.size,
    layer: layer.value,
    isFilled: (pos) => bp.get(pos) !== null,
    // 置くツールでは、枠のすぐ外（1マス）にも置ける（#191）
    margin: tools.activeToolId === 'place' ? GROW_MARGIN_2D : 0,
  }
  return pick2D(e.clientX - rect.left, e.clientY - rect.top, grid, scene)
}

function samePos(a: PickTarget | null, b: PickTarget | null): boolean {
  if (a === null || b === null) return a === b
  return a.empty === b.empty && a.pos[0] === b.pos[0] && a.pos[1] === b.pos[1] && a.pos[2] === b.pos[2]
}

function modsOf(e: MouseEvent): PickModifiers {
  return { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey }
}

/** canvas の中の位置 */
function canvasPoint(e: MouseEvent): { x: number; y: number } | null {
  const el = canvas.value
  if (!el) return null
  const rect = el.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

/**
 * 選択ツールのドラッグ（#130）。押したマス、押したときの起点の段、別のマスへ動いたか。
 * 動かずに離したときは、ふつうのクリック（onClick）に任せる
 */
interface DragSelect {
  readonly kind: 'select'
  readonly pointerId: number
  readonly start: Cell2D
  readonly anchorLayer: number | null
  moved: boolean
}
/**
 * 置くツールのドラッグ（#161）。押したマスから別のマスへ動いたら、一直線に置くドラッグを始める。
 * 動かずに離したときは、ふつうのクリック（onClick）に任せる
 */
interface DragPlace {
  readonly kind: 'place'
  readonly pointerId: number
  readonly start: Cell2D
  readonly target: PickTarget
  moved: boolean
}
/**
 * 範囲をつかんで動かすドラッグ（#199）。押したマスから別のマスへ動いたら始める。
 * 動かずに離したときは、ふつうのクリック（onClick）に任せる
 */
interface DragMoveRange {
  readonly kind: 'move'
  readonly pointerId: number
  readonly start: Cell2D
  /** 今のずれ */
  offset: Vec3
  moved: boolean
}
/** 範囲の辺を引くドラッグ（#205）。押したらすぐ始め、離したときのクリックは出さない */
interface DragResize {
  readonly kind: 'resize'
  readonly pointerId: number
  moved: boolean
}
let drag: DragSelect | DragPlace | DragMoveRange | DragResize | null = null

/** canvas の中の位置のマス。マス目の外でもそのまま（範囲を枠の外へ動かせるように） */
function cellAt(p: { x: number; y: number }, grid: GridLayout2D): Cell2D {
  return [Math.floor((p.x - grid.originX) / grid.cellSize), Math.floor((p.y - grid.originY) / grid.cellSize)]
}
/** ドラッグで範囲を選んだ直後のクリックを、選択の操作にしない */
let suppressClick = false

/** ドラッグで今のマスまでの範囲を選ぶ。まだ押したマスから動いていなければ何もしない */
function updateDrag(e: PointerEvent): void {
  const bp = blueprint.value
  const grid = layout.value
  const p = canvasPoint(e)
  if (!drag || !bp || !grid || !p) return
  if (drag.kind === 'resize') {
    // マウスの位置にいちばん近いマスの境目へ、つかんだ辺を動かす
    rangeResize.update((axis) => (axis === 0 ? (p.x - grid.originX) / grid.cellSize : (p.y - grid.originY) / grid.cellSize))
    drag.moved = true
    return
  }
  if (drag.kind === 'move') {
    const at = cellAt(p, grid)
    if (!drag.moved && !isDrag2D(drag.start, at)) return
    if (!drag.moved) {
      drag.moved = true
      if (!dragMove.begin()) return
    }
    drag.offset = [at[0] - drag.start[0], 0, at[1] - drag.start[1]]
    dragMove.update(drag.offset, modsOf(e))
    return
  }
  const cell = clampedCell2D(p.x, p.y, grid, bp.size)
  if (!drag.moved && !isDrag2D(drag.start, cell)) return
  if (drag.kind === 'place') {
    updatePlaceDrag(drag, cell)
    return
  }
  drag.moved = true
  // Shift+ドラッグなら、起点の段から今の段までの高さにする
  const anchor = e.shiftKey ? drag.anchorLayer : null
  // 起点はドラッグを始めたマス（Shift+ドラッグなら起点の段）。続く Shift+クリックはそこから広げる
  tools.setSelectionBox(dragSelectionBox(drag.start, cell, layer.value, anchor), [drag.start[0], anchor ?? layer.value, drag.start[1]])
}

/** 置くツールのドラッグで、今のマス（マス目の中に収める）まで線を引く（#161） */
function updatePlaceDrag(d: DragPlace, cell: Cell2D): void {
  if (!d.moved) {
    d.moved = true
    // ツールが受け取らなければ（置くブロックがない など）、離したときのクリックも出さない
    if (!tools.beginDrag(d.target)) return
  }
  tools.dragTo({ pos: [cell[0], layer.value, cell[1]], empty: blueprint.value?.get([cell[0], layer.value, cell[1]]) === null })
}

/** 表示を動かすドラッグ（#155）。押した位置と、そのときのマス目の置き方 */
interface Pan {
  readonly pointerId: number
  readonly button: number
  readonly startX: number
  readonly startY: number
  readonly from: GridLayout2D
}
let pan: Pan | null = null
const panning = ref(false)
/** 空白キーを押している（左ドラッグで表示を動かす） */
const spaceHeld = ref(false)
/** マウスが 2D表示の上にある。空白キーはこのときだけ使う */
let pointerInside = false

function startPan(e: PointerEvent): boolean {
  const grid = layout.value
  if (!grid) return false
  if (e.button !== 1 && !(e.button === 0 && spaceHeld.value)) return false
  e.preventDefault()
  pan = { pointerId: e.pointerId, button: e.button, startX: e.clientX, startY: e.clientY, from: grid }
  panning.value = true
  tools.hover(null)
  try {
    canvas.value?.setPointerCapture?.(e.pointerId)
  } catch {
    // 捕まえられなくても、ドラッグはできる
  }
  return true
}

function endPan(e: PointerEvent): void {
  if (!pan) return
  // 左ドラッグで動かしたときは、続いて来るクリックで選ばない
  if (pan.button === 0) suppressClick = true
  pan = null
  panning.value = false
  endDrag(e)
}

function onWheel(e: WheelEvent): void {
  const grid = layout.value
  const p = canvasPoint(e)
  if (!grid || !p) return
  const s = size.value
  const next = zoomAt(grid, p.x, p.y, wheelZoomFactor(e.deltaY, e.deltaMode))
  if (next === grid || !s) return
  zoomed.value = clampToView(next, s, width.value, height.value)
  onHover(e)
}

/** 中ボタンを押したときの、ブラウザの自動スクロールを止める */
function onMouseDown(e: MouseEvent): void {
  if (e.button === 1) e.preventDefault()
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.code !== 'Space' || !pointerInside || isTyping(e.target)) return
  // ページのスクロールや、フォーカスのあるボタンを押すのを止める
  e.preventDefault()
  spaceHeld.value = true
}

function onKeyUp(e: KeyboardEvent): void {
  if (e.code !== 'Space' || !spaceHeld.value) return
  e.preventDefault()
  spaceHeld.value = false
}

function onBlur(): void {
  spaceHeld.value = false
}

function onPointerDown(e: PointerEvent): void {
  suppressClick = false
  drag = null
  if (startPan(e)) return
  const kind = tools.activeToolId === 'select' ? 'select' : tools.activeToolId === 'place' ? 'place' : null
  if (e.button !== 0 || kind === null) return
  const bp = blueprint.value
  const grid = layout.value
  const p = canvasPoint(e)
  if (!bp || !grid || !p) return
  // 範囲の辺（#205）。範囲をつかむより先に当たる。マス目の外側から近づいても当たる
  const edge = kind === 'select' ? edgeAt(e) : null
  if (edge && rangeResize.begin(edge)) {
    drag = { kind: 'resize', pointerId: e.pointerId, moved: false }
    try {
      canvas.value?.setPointerCapture?.(e.pointerId)
    } catch {
      // 捕まえられなくても、ドラッグはできる
    }
    return
  }
  // 置くツールは枠のすぐ外からも引ける（#191）。どこを押したかは pickAt で決める
  if (kind === 'select' && !insideGrid2D(p.x, p.y, grid, bp.size)) return
  const start = clampedCell2D(p.x, p.y, grid, bp.size)
  // 範囲の中（範囲の段にいるとき）を押したら、範囲をつかむ（#199）
  const box = tools.selectionBox
  // 1マスだけのとき（クリックで選んだブロック）は、今までどおりそこから範囲を選ぶ
  if (kind === 'select' && box && !isSingleCell(box) && boxContains(box, [start[0], layer.value, start[1]])) {
    drag = { kind: 'move', pointerId: e.pointerId, start, offset: [0, 0, 0], moved: false }
  } else if (kind === 'select') {
    drag = { kind, pointerId: e.pointerId, start, anchorLayer: tools.selectedPos ? tools.selectedPos[1] : null, moved: false }
  } else {
    const target = pickAt(e)
    if (!target) return
    drag = { kind, pointerId: e.pointerId, start, target, moved: false }
  }
  // マス目の外へ出ても離したことが分かるように
  try {
    canvas.value?.setPointerCapture?.(e.pointerId)
  } catch {
    // 捕まえられなくても、ドラッグはできる
  }
}

function endDrag(e: PointerEvent): void {
  // 置くツールのドラッグの途中で取られたときは、線をやめる
  if (drag?.kind === 'place' && tools.isDragging()) tools.cancelDrag()
  // 範囲をつかんだまま取られたときは、動かさない（#199）
  if (drag?.kind === 'move') dragMove.cancel()
  if (drag?.kind === 'resize') rangeResize.end()
  try {
    if (canvas.value?.hasPointerCapture?.(e.pointerId)) canvas.value.releasePointerCapture(e.pointerId)
  } catch {
    // 放せなくても困らない
  }
  drag = null
}

function onPointerUp(e: PointerEvent): void {
  if (pan && pan.pointerId === e.pointerId) {
    endPan(e)
    return
  }
  if (!drag || drag.pointerId !== e.pointerId) return
  updateDrag(e)
  // 範囲を選んだとき・線を引いたとき・辺を引いたときは、続いて来るクリックで選び直さない・置かない
  if (drag.moved || drag.kind === 'resize') suppressClick = true
  // 一直線に置く（#161）。離したマスまでで置く
  if (drag.kind === 'place' && tools.isDragging()) tools.endDrag(null, modsOf(e))
  // 範囲を動かす・写す（#199）
  if (drag.kind === 'move' && drag.moved) {
    dragMove.finish(drag.offset, modsOf(e))
    drag = null
  }
  endDrag(e)
}

function onPointerCancel(e: PointerEvent): void {
  if (pan) endPan(e)
  if (drag) endDrag(e)
}

function onHover(e: MouseEvent): void {
  const target = pickAt(e)
  // 同じマスの中で動いたときは知らせない（描き直しを減らす）
  if (!samePos(target, tools.hoverTarget)) tools.hover(target)
}

function onPointerMove(e: PointerEvent): void {
  pointerInside = true
  if (pan && pan.pointerId === e.pointerId) {
    const s = size.value
    const next = panBy(pan.from, e.clientX - pan.startX, e.clientY - pan.startY)
    zoomed.value = s ? clampToView(next, s, width.value, height.value) : next
    return
  }
  onHover(e)
  if (drag && drag.pointerId === e.pointerId) updateDrag(e)
  else if (e.buttons === 0) {
    const h = edgeAt(e)
    edgeCursor.value = h ? edgeCursor2D(h) : null
  }
}

function onPointerEnter(): void {
  pointerInside = true
}

function onPointerLeave(): void {
  pointerInside = false
  tools.hover(null)
}

/** 選択ツールでブロックをダブルクリックすると、つながったブロックをまとめて選ぶ（#205） */
function onDoubleClick(e: MouseEvent): void {
  if (e.button !== 0 || tools.activeToolId !== 'select' || paste.active) return
  const target = pickAt(e)
  if (target && !target.empty) selectConnected(target.pos)
}

function onClick(e: MouseEvent): void {
  if (suppressClick) {
    suppressClick = false
    return
  }
  const target = pickAt(e)
  if (target) tools.click(target, { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey })
}

let resizeObserver: ResizeObserver | null = null
let darkQuery: MediaQueryList | null = null
const onThemeChange = (): void => {
  dark.value = darkQuery?.matches ?? false
}

function measure(): void {
  const el = host.value
  if (!el) return
  width.value = el.clientWidth
  height.value = el.clientHeight
}

onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && host.value) {
    resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(host.value)
  }
  if (typeof window.matchMedia === 'function') {
    darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
    onThemeChange()
    darkQuery.addEventListener('change', onThemeChange)
  }
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  // 文字のフォントが読み込まれたら、目盛りと略称を描き直す
  void document.fonts?.ready.then(() => draw())
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  darkQuery?.removeEventListener('change', onThemeChange)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('blur', onBlur)
  drag = null
  pan = null
  tools.hover(null)
})
</script>

<template>
  <div ref="host" class="layer-view-2d" data-testid="layer-view-2d">
    <canvas
      ref="canvas"
      aria-label="今の段のマス目"
      :class="{ grab: spaceHeld, grabbing: panning }"
      :style="edgeCursor && !spaceHeld && !panning ? { cursor: edgeCursor } : undefined"
      @pointerenter="onPointerEnter"
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
      @pointerdown="onPointerDown"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @click="onClick"
      @dblclick="onDoubleClick"
      @mousedown="onMouseDown"
      @wheel.prevent="onWheel"
    ></canvas>
    <div class="compass" aria-label="上が北（−Z）">
      <span class="arrow" aria-hidden="true">↑</span> 北（−Z）
    </div>
    <div class="layer-label" data-testid="layer-view-2d-layer">{{ layerLabel }}</div>
    <!-- 範囲のツールバー（#160） -->
    <SelectionToolbar :rect="selectionRect" :view-width="width" :view-height="height" />
  </div>
</template>

<style scoped>
.layer-view-2d {
  position: absolute;
  inset: 0;
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: crosshair;
}

canvas.grab {
  cursor: grab;
}

canvas.grabbing {
  cursor: grabbing;
}

.compass,
.layer-label {
  position: absolute;
  top: 10px;
  font-size: 12px;
  opacity: 0.75;
  pointer-events: none;
}

.compass {
  right: 12px;
}

.layer-label {
  right: 12px;
  top: 28px;
  font-variant-numeric: tabular-nums;
}

.arrow {
  font-weight: bold;
}
</style>
