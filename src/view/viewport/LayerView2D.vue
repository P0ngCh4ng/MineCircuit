<script setup lang="ts">
// 2D表示（LayerView2D）。今の段を真上から見たマス目で描く。docs/ui.md「2D表示と計測」。
// マウスの位置は picker.ts の pick2D でマスに直し、toolStore を通して今のツールに渡す。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isSingleCell } from '../../domain/box'
import { useSearchHighlight } from '../analysis/useSearchHighlight'
import { useDocumentSession } from '../document/documentSession'
import { useAppearanceStore } from '../stores/appearanceStore'
import { useCalcStore } from '../stores/calcStore'
import { clampLayer, useLayerStore } from '../stores/layerStore'
import { useProbeStore } from '../stores/probeStore'
import { useMeasureStore } from '../stores/measureStore'
import { usePortStore } from '../stores/portStore'
import { useToolStore } from '../stores/toolStore'
import { useViewStore } from '../stores/viewStore'
import { pick2D, type GridLayout2D, type PickScene2D } from '../tools/picker'
import type { PickTarget } from '../tools/tool'
import { ANALYSIS_COLORS_2D, drawAnalysisOverlay2D } from './analysisOverlay2D'
import { clampedCell2D, dragSelectionBox, insideGrid2D, isDrag2D, type Cell2D } from './dragSelect2D'
import { layoutGrid2D } from './layerGrid2D'
import { drawPortOverlay2D } from './portOverlay2D'
import { DARK_THEME_2D, drawLayer2D, drawSelectionBox2D, LIGHT_THEME_2D } from './layerRenderer2D'
import { createTextureCellPainter } from './textureCellPainter2D'

const props = withDefaults(defineProps<{ showGrid?: boolean }>(), { showGrid: true })

const session = useDocumentSession()
const layers = useLayerStore()
const tools = useToolStore()
const viewMode = useViewStore()
/** 検索で強調するブロックの位置（#15） */
const highlight = useSearchHighlight()
const calc = useCalcStore()
const probe = useProbeStore()
const measures = useMeasureStore()
const ports = usePortStore()
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

/** マス目の置き方。描くときと、マウスの位置をマスに直すときに使う */
const layout = computed<GridLayout2D | null>(() => {
  const s = size.value
  if (!s || width.value === 0 || height.value === 0) return null
  return layoutGrid2D(width.value, height.value, s)
})

/** 今の段（設計図の高さに収める） */
const layer = computed(() => {
  const s = size.value
  return s ? clampLayer(layers.current, s[1]) : 0
})

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
    cellPainter: cellPainter.value,
  })
  // 選択範囲の長方形。範囲の外の段では点線（#130）
  drawSelectionBox2D(ctx, grid, layer.value, box, theme)
  // 計測とつながり（#16）
  drawAnalysisOverlay2D(
    ctx,
    grid,
    layer.value,
    { measurePoints: measures.measurePoints, connectGroup: measures.connectGroup?.positions ?? null },
    ANALYSIS_COLORS_2D[dark.value ? 'dark' : 'light'],
  )
  // 仮の入出力（#70）
  drawPortOverlay2D(ctx, grid, layer.value, ports.ports, ports.selectedId)
}

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
  () => [probe.networkPositions, calc.issuePositions, viewMode.showRotation, calc.rotations],
  () => draw(),
  { flush: 'post' },
)

// 計測とつながりが変わったら描き直す（#16）
watch(
  () => [measures.measurePoints, measures.connectGroup],
  () => draw(),
  { flush: 'post' },
)

// 設計図・段・表示の設定・マウスの下・選択が変わったら描き直す
watch(
  () => [layout.value, session.version.value, layer.value, viewMode.showLabels, props.showGrid, tools.hoverTarget, tools.selectedPos, tools.selectionBox, dark.value, highlight.value],
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
  }
  return pick2D(e.clientX - rect.left, e.clientY - rect.top, grid, scene)
}

function samePos(a: PickTarget | null, b: PickTarget | null): boolean {
  if (a === null || b === null) return a === b
  return a.empty === b.empty && a.pos[0] === b.pos[0] && a.pos[1] === b.pos[1] && a.pos[2] === b.pos[2]
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
  readonly pointerId: number
  readonly start: Cell2D
  readonly anchorLayer: number | null
  moved: boolean
}
let drag: DragSelect | null = null
/** ドラッグで範囲を選んだ直後のクリックを、選択の操作にしない */
let suppressClick = false

/** ドラッグで今のマスまでの範囲を選ぶ。まだ押したマスから動いていなければ何もしない */
function updateDrag(e: PointerEvent): void {
  const bp = blueprint.value
  const grid = layout.value
  const p = canvasPoint(e)
  if (!drag || !bp || !grid || !p) return
  const cell = clampedCell2D(p.x, p.y, grid, bp.size)
  if (!drag.moved && !isDrag2D(drag.start, cell)) return
  drag.moved = true
  // Shift+ドラッグなら、起点の段から今の段までの高さにする
  const anchor = e.shiftKey ? drag.anchorLayer : null
  // 起点はドラッグを始めたマス（Shift+ドラッグなら起点の段）。続く Shift+クリックはそこから広げる
  tools.setSelectionBox(dragSelectionBox(drag.start, cell, layer.value, anchor), [drag.start[0], anchor ?? layer.value, drag.start[1]])
}

function onPointerDown(e: PointerEvent): void {
  suppressClick = false
  drag = null
  if (e.button !== 0 || tools.activeToolId !== 'select') return
  const bp = blueprint.value
  const grid = layout.value
  const p = canvasPoint(e)
  if (!bp || !grid || !p || !insideGrid2D(p.x, p.y, grid, bp.size)) return
  drag = {
    pointerId: e.pointerId,
    start: clampedCell2D(p.x, p.y, grid, bp.size),
    anchorLayer: tools.selectedPos ? tools.selectedPos[1] : null,
    moved: false,
  }
  // マス目の外へ出ても離したことが分かるように
  try {
    canvas.value?.setPointerCapture?.(e.pointerId)
  } catch {
    // 捕まえられなくても、ドラッグはできる
  }
}

function endDrag(e: PointerEvent): void {
  try {
    if (canvas.value?.hasPointerCapture?.(e.pointerId)) canvas.value.releasePointerCapture(e.pointerId)
  } catch {
    // 放せなくても困らない
  }
  drag = null
}

function onPointerUp(e: PointerEvent): void {
  if (!drag || drag.pointerId !== e.pointerId) return
  updateDrag(e)
  // 範囲を選んだときは、続いて来るクリックで選び直さない
  if (drag.moved) suppressClick = true
  endDrag(e)
}

function onPointerCancel(e: PointerEvent): void {
  if (drag) endDrag(e)
}

function onPointerMove(e: PointerEvent): void {
  const target = pickAt(e)
  // 同じマスの中で動いたときは知らせない（描き直しを減らす）
  if (!samePos(target, tools.hoverTarget)) tools.hover(target)
  if (drag && drag.pointerId === e.pointerId) updateDrag(e)
}

function onPointerLeave(): void {
  tools.hover(null)
}

function onClick(e: MouseEvent): void {
  if (suppressClick) {
    suppressClick = false
    return
  }
  const target = pickAt(e)
  if (target) tools.click(target, { shift: e.shiftKey, alt: e.altKey })
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
  // 文字のフォントが読み込まれたら、目盛りと略称を描き直す
  void document.fonts?.ready.then(() => draw())
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  darkQuery?.removeEventListener('change', onThemeChange)
  drag = null
  tools.hover(null)
})
</script>

<template>
  <div ref="host" class="layer-view-2d" data-testid="layer-view-2d">
    <canvas
      ref="canvas"
      aria-label="今の段のマス目"
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
      @pointerdown="onPointerDown"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @click="onClick"
    ></canvas>
    <div class="compass" aria-label="上が北（−Z）">
      <span class="arrow" aria-hidden="true">↑</span> 北（−Z）
    </div>
    <div class="layer-label" data-testid="layer-view-2d-layer">{{ layerLabel }}</div>
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
