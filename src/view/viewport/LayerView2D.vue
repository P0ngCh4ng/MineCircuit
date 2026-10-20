<script setup lang="ts">
// 2D表示（LayerView2D）。今の段を真上から見たマス目で描く。docs/ui.md「2D表示と計測」。
// マウスの位置は picker.ts の pick2D でマスに直し、toolStore を通して今のツールに渡す。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSearchHighlight } from '../analysis/useSearchHighlight'
import { useDocumentSession } from '../document/documentSession'
import { clampLayer, useLayerStore } from '../stores/layerStore'
import { useToolStore } from '../stores/toolStore'
import { useViewStore } from '../stores/viewStore'
import { pick2D, type GridLayout2D, type PickScene2D } from '../tools/picker'
import type { PickTarget } from '../tools/tool'
import { layoutGrid2D } from './layerGrid2D'
import { DARK_THEME_2D, drawLayer2D, LIGHT_THEME_2D } from './layerRenderer2D'

const props = withDefaults(defineProps<{ showGrid?: boolean }>(), { showGrid: true })

const session = useDocumentSession()
const layers = useLayerStore()
const tools = useToolStore()
const viewMode = useViewStore()
/** 検索で強調するブロックの位置（#15） */
const highlight = useSearchHighlight()

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

/** マス目の置き方。描くときと、マウスの位置をマスに直すときに使う */
const layout = computed<GridLayout2D | null>(() => {
  const bp = blueprint.value
  if (!bp || width.value === 0 || height.value === 0) return null
  return layoutGrid2D(width.value, height.value, bp.size)
})

/** 今の段（設計図の高さに収める） */
const layer = computed(() => {
  const bp = blueprint.value
  return bp ? clampLayer(layers.current, bp.size[1]) : 0
})

const layerLabel = computed(() => {
  const bp = blueprint.value
  return bp ? `段 ${layer.value + 1} / ${bp.size[1]}` : ''
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
  drawLayer2D(ctx, width.value, height.value, {
    blueprint: bp,
    layer: layer.value,
    layout: grid,
    theme: dark.value ? DARK_THEME_2D : LIGHT_THEME_2D,
    showGrid: props.showGrid,
    showLabels: viewMode.showLabels,
    hovered: tools.hoverTarget?.pos ?? null,
    selected: tools.selectedPos,
    fontFamily: getComputedStyle(el).fontFamily || 'sans-serif',
    highlighted: highlight.value,
  })
}

// 設計図・段・表示の設定・マウスの下・選択が変わったら描き直す
watch(
  () => [layout.value, session.version.value, layer.value, viewMode.showLabels, props.showGrid, tools.hoverTarget, tools.selectedPos, dark.value, highlight.value],
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

function onPointerMove(e: PointerEvent): void {
  const target = pickAt(e)
  // 同じマスの中で動いたときは知らせない（描き直しを減らす）
  if (!samePos(target, tools.hoverTarget)) tools.hover(target)
}

function onPointerLeave(): void {
  tools.hover(null)
}

function onClick(e: MouseEvent): void {
  const target = pickAt(e)
  if (target) tools.click(target, { shift: e.shiftKey })
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
