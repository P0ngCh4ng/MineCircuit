<script setup lang="ts">
// 段の一覧。docs/ui.md「段の一覧」。
// 段ごとにブロック数を出し、左の丸で表示・非表示を切り替える。段を押すとその段を今の段にする。
// 画面の段は 1 始まり（コードの y + 1）。上の段を上に並べる。
import { computed, nextTick, ref, watch } from 'vue'
import { useBlueprintStats } from '../analysis/useBlueprintStats'
import { useDocumentSession } from '../document/documentSession'
import { useViewStore } from '../stores/viewStore'
import { useKeyboardShortcuts } from '../tools/useKeyboardShortcuts'
import { useLayerNavigation } from './useLayerNavigation'

interface LayerRow {
  readonly y: number
  readonly count: number
  readonly hidden: boolean
}

const session = useDocumentSession()
const view = useViewStore()
const nav = useLayerNavigation()
const stats = useBlueprintStats()
const list = ref<HTMLElement | null>(null)

/** 段ごとのブロック数（y の順） */
const counts = computed<number[]>(() => {
  const s = stats.value
  if (!s) return []
  const result: number[] = []
  for (let y = 0; y < nav.height.value; y++) {
    let n = 0
    for (const c of s.countLayer(y).values()) n += c
    result.push(n)
  }
  return result
})

const rows = computed<LayerRow[]>(() => {
  const hidden = view.hiddenLayers
  return counts.value.map((count, y) => ({ y, count, hidden: hidden.has(y) })).reverse()
})

const canShowAll = computed(() => view.hiddenLayers.size > 0 || view.layerMode !== 'all')

function toggle(y: number): void {
  view.setLayerHidden(y, !view.hiddenLayers.has(y))
}

function solo(): void {
  view.soloLayer(nav.current.value, nav.height.value)
}

// 別の設計図を開いたら、前の設計図の非表示を消し、今の段を高さに収める
watch(session.current, () => {
  view.setHiddenLayers(new Set())
  nav.select(nav.current.value)
})

// 今の段が一覧の外にあれば見える所まで動かす
watch(nav.current, async () => {
  await nextTick()
  const active = list.value?.querySelector<HTMLElement>('[aria-current="true"]')
  active?.scrollIntoView?.({ block: 'nearest' })
})

useKeyboardShortcuts({
  layerUp: () => nav.up(),
  layerDown: () => nav.down(),
})
</script>

<template>
  <nav class="panel layer-panel" aria-label="段の一覧">
    <div class="head">
      <span class="bar-label">段・ブロック数</span>
    </div>
    <p v-if="nav.height.value === 0" class="note">設計図を開くと、段が出ます。</p>
    <ul v-else ref="list" class="layers">
      <li
        v-for="row in rows"
        :key="row.y"
        :class="{ off: row.hidden }"
        :data-layer="row.y"
        :aria-current="row.y === nav.current.value ? 'true' : undefined"
      >
        <button
          type="button"
          class="eye"
          :aria-pressed="!row.hidden"
          :aria-label="`段 ${row.y + 1} を${row.hidden ? '表示する' : '隠す'}`"
          :title="row.hidden ? 'この段を表示する' : 'この段を隠す'"
          @click="toggle(row.y)"
        />
        <button type="button" class="pick" :title="`段 ${row.y + 1}（Y=${row.y}）を今の段にする`" @click="nav.select(row.y)">
          <b>{{ row.y + 1 }}</b>
          <span>{{ row.count.toLocaleString() }}</span>
        </button>
      </li>
    </ul>
    <div class="foot">
      <button type="button" data-action="show-all" title="非表示の段をなくし、表示方法を「すべて」にする" :disabled="!canShowAll" @click="view.showAllLayers()">
        すべて表示
      </button>
      <button type="button" data-action="solo" title="今の段だけを表示し、ほかの段を隠す" :disabled="nav.height.value === 0" @click="solo">
        この段だけ表示
      </button>
    </div>
  </nav>
</template>

<style scoped>
.layer-panel {
  display: flex;
  flex-direction: column;
}

.head {
  padding: 10px 8px 6px;
  border-bottom: 1px solid var(--line);
  text-align: center;
}

.note {
  margin: 8px;
  font-size: 12px;
  opacity: 0.75;
}

.layers {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
  list-style: none;
  display: grid;
  align-content: start;
  gap: 1px;
}

li {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  align-items: center;
  border-radius: 4px;
}

li[aria-current='true'] {
  background: color-mix(in srgb, Highlight 22%, Canvas);
  box-shadow: inset 2px 0 0 Highlight;
}

.eye {
  width: 20px;
  height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  display: grid;
  place-items: center;
}

.eye::before {
  content: '';
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.5px solid currentColor;
  opacity: 0.7;
}

.eye[aria-pressed='true']::before {
  background: currentColor;
}

.pick {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 4px;
  padding: 4px 6px 4px 2px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  font-variant-numeric: tabular-nums;
}

.pick span {
  font-size: 10.5px;
  opacity: 0.7;
}

li.off .pick b {
  opacity: 0.6;
  text-decoration: line-through;
}

.foot {
  display: grid;
  gap: 4px;
  padding: 6px;
  border-top: 1px solid var(--line);
}

.foot button {
  font-size: 11.5px;
  padding: 3px 4px;
}

@media (max-width: 900px) {
  .layers {
    max-height: 220px;
  }
}
</style>
