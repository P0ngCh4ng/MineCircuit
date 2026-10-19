<script setup lang="ts">
// 左パネルの「ブロック一覧」。ID ごとのブロック数を、全体か今の段で出す（#11）。
// 名前は Modpack を読み込んでいれば表示名、なければ ID。絞り込み検索と強調は #15 で足す。
import { computed, ref } from 'vue'
import { useDocumentSession } from '../document/documentSession'
import { useModpackContentStore } from '../stores/modpackContent'
import { clampLayer, useLayerStore } from '../stores/layerStore'
import { useBlueprintStats } from './useBlueprintStats'

type CountScope = 'all' | 'layer'

interface BlockRow {
  readonly id: string
  /** 表示名。ないときは null（ID を名前として出す） */
  readonly name: string | null
  readonly count: number
}

const session = useDocumentSession()
const content = useModpackContentStore()
const layers = useLayerStore()
const stats = useBlueprintStats()

const scope = ref<CountScope>('all')

/** 今の段（y）。設計図の高さに収める */
const layer = computed(() => {
  const bp = session.current.value?.blueprint
  return bp ? clampLayer(layers.current, bp.size[1]) : 0
})

const rows = computed<BlockRow[]>(() => {
  const s = stats.value
  if (!s) return []
  const counts = scope.value === 'all' ? s.countAll() : s.countLayer(layer.value)
  return [...counts].map(([id, count]) => ({ id, name: content.displayName(id), count }))
})

const total = computed(() => rows.value.reduce((sum, r) => sum + r.count, 0))

const summary = computed(() => {
  if (rows.value.length === 0) return null
  const where = scope.value === 'layer' ? `（段 ${layer.value + 1}）` : ''
  return `${rows.value.length.toLocaleString()} 種類・${total.value.toLocaleString()} 個${where}`
})

const note = computed(() => {
  if (!session.current.value) return '設計図を開くと、ブロックの数が出ます。'
  if (rows.value.length === 0) {
    return scope.value === 'layer' ? `段 ${layer.value + 1} にブロックはありません。` : 'ブロックが置かれていません。'
  }
  if (content.phase !== 'loaded') return '名前は ID のままです。Modpack を読み込むと、Mod のブロックは表示名で出ます。'
  return null
})
</script>

<template>
  <section class="block-list" aria-labelledby="block-list-heading">
    <div class="head">
      <h2 id="block-list-heading">ブロック一覧</h2>
      <span class="seg" role="group" aria-label="数える範囲">
        <button type="button" data-scope="all" :aria-pressed="scope === 'all'" @click="scope = 'all'">全体</button>
        <button
          type="button"
          data-scope="layer"
          :aria-pressed="scope === 'layer'"
          :title="`今の段（段 ${layer + 1}）だけを数える`"
          @click="scope = 'layer'"
        >
          この段
        </button>
      </span>
    </div>
    <!-- 絞り込み検索（#15）はここに足す -->
    <ul v-if="rows.length > 0" class="rows">
      <li v-for="r in rows" :key="r.id" :data-id="r.id">
        <span class="name" :title="r.id">
          {{ r.name ?? r.id }}
          <small v-if="r.name">{{ r.id }}</small>
        </span>
        <span class="count">{{ r.count.toLocaleString() }}</span>
      </li>
    </ul>
    <p v-if="summary" class="summary">{{ summary }}</p>
    <p v-if="note" class="note">{{ note }}</p>
  </section>
</template>

<style scoped>
.block-list {
  display: grid;
  gap: 6px;
}

.head {
  display: flex;
  align-items: center;
  gap: 6px;
}

h2 {
  flex: 1;
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  opacity: 0.75;
}

.seg {
  display: inline-flex;
}

.seg button {
  padding: 1px 8px;
  border: 1px solid var(--line);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.seg button:first-child {
  border-radius: 3px 0 0 3px;
}

.seg button:last-child {
  border-left: none;
  border-radius: 0 3px 3px 0;
}

.seg button[aria-pressed='true'] {
  background: color-mix(in srgb, CanvasText 14%, transparent);
  font-weight: 600;
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 2px;
}

.rows li {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
}

.name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.name small {
  display: block;
  font-size: 10px;
  opacity: 0.6;
}

.count {
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

.summary,
.note {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}

.note {
  opacity: 0.75;
}
</style>
