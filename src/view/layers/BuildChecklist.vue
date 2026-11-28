<script setup lang="ts">
// 左パネルの「建築チェックリスト」（docs/ui.md「建築チェックリスト」。#274）。
// 今の段に要るブロックと数を出し、建て終えた段にチェックを付ける。全部の段の表を印刷できる。
// チェックは設計図のファイルに書かず、ブラウザ内に保存する（stores/buildChecklistStore.ts）。
import { computed, nextTick, ref } from 'vue'
import { useDocumentSession } from '../document/documentSession'
import { useModpackContentStore } from '../stores/modpackContent'
import { useBuildChecklist } from './useBuildChecklist'
import { useLayerNavigation } from './useLayerNavigation'

const props = withDefaults(defineProps<{ print?: () => void }>(), {
  print: () => window.print(),
})

const session = useDocumentSession()
const content = useModpackContentStore()
const nav = useLayerNavigation()
const checklist = useBuildChecklist()

const hasBlueprint = computed(() => session.current.value !== null)

/** 名前は表示名、なければ ID */
function nameOf(id: string): string {
  return content.displayName(id) ?? id
}

const layer = computed(() => checklist.layers.value[nav.current.value] ?? null)
const isDone = computed(() => layer.value !== null && checklist.done.value.has(layer.value.y))

const progressText = computed(() => {
  const p = checklist.progress.value
  if (p.layerCount === 0) return null
  return `建てた段 ${p.doneLayerCount} / ${p.layerCount}・${p.doneBlockCount.toLocaleString()} / ${p.blockCount.toLocaleString()} 個`
})

const hasChecks = computed(() => checklist.done.value.size > 0)

/** チェックを付けたら、次の段へ進む（下の段から建てるので） */
function onToggle(e: Event): void {
  const current = layer.value
  if (!current) return
  const checked = (e.target as HTMLInputElement).checked
  checklist.setDone(current.y, checked)
  if (checked) nav.up()
}

const printing = ref(false)
/** 印刷する段。ブロックのない段は出さない */
const printLayers = computed(() => checklist.layers.value.filter((l) => l.total > 0))
const fileName = computed(() => session.current.value?.fileName ?? '')

async function onPrint(): Promise<void> {
  printing.value = true
  await nextTick()
  try {
    props.print()
  } finally {
    printing.value = false
  }
}
</script>

<template>
  <section class="build-checklist" aria-labelledby="build-checklist-heading">
    <div class="head">
      <h2 id="build-checklist-heading">建築チェックリスト</h2>
      <button
        type="button"
        data-action="print-checklist"
        :disabled="!hasBlueprint"
        title="全部の段の表を印刷する。PDF にも保存できる"
        @click="onPrint"
      >
        印刷…
      </button>
    </div>
    <p v-if="!hasBlueprint" class="note">設計図を開くと、段ごとに要るブロックが出ます。</p>
    <template v-else-if="layer">
      <p v-if="progressText" class="progress" data-testid="checklist-progress">{{ progressText }}</p>
      <div class="layer-row">
        <label class="done">
          <!-- 段ごとに作り直す。押した印が次の段のチェック欄に残らないように -->
          <input
            :key="layer.y"
            type="checkbox"
            data-action="toggle-layer-done"
            :checked="isDone"
            :disabled="layer.total === 0"
            @change="onToggle"
          />
          段 {{ layer.y + 1 }} を建て終えた
        </label>
        <span class="nav">
          <button type="button" data-action="checklist-down" title="1つ下の段へ" :disabled="!nav.canDown.value" @click="nav.down()">
            前の段
          </button>
          <button type="button" data-action="checklist-up" title="1つ上の段へ" :disabled="!nav.canUp.value" @click="nav.up()">
            次の段
          </button>
        </span>
      </div>
      <ul v-if="layer.items.length > 0" class="items" :class="{ finished: isDone }">
        <li v-for="item in layer.items" :key="item.id" :data-id="item.id">
          <span class="name">
            {{ nameOf(item.id) }}
            <small v-if="nameOf(item.id) !== item.id">{{ item.id }}</small>
          </span>
          <span class="count">{{ item.count.toLocaleString() }}</span>
        </li>
      </ul>
      <p v-if="layer.total > 0" class="summary">
        段 {{ layer.y + 1 }}：{{ layer.items.length }} 種類・{{ layer.total.toLocaleString() }} 個
      </p>
      <p v-else class="note">段 {{ layer.y + 1 }} にブロックはありません。</p>
      <button
        v-if="hasChecks"
        type="button"
        class="clear"
        data-action="clear-checklist"
        title="この設計図のチェックをすべて外す"
        @click="checklist.clear()"
      >
        チェックを外す
      </button>
    </template>

    <Teleport v-if="printing" to="body">
      <div class="print-sheet" data-testid="checklist-print">
        <h1>建築チェックリスト：{{ fileName }}</h1>
        <p>{{ progressText }}。下の段から順に並べています。建て終えたら □ に印を付けてください。</p>
        <table v-for="l in printLayers" :key="l.y" :data-layer="l.y">
          <caption>
            {{ checklist.done.value.has(l.y) ? '☑' : '☐' }} 段 {{ l.y + 1 }}（Y={{ l.y }}）・{{ l.total.toLocaleString() }} 個
          </caption>
          <thead>
            <tr>
              <th class="box">済</th>
              <th class="name">ブロック</th>
              <th>ID</th>
              <th class="num">数</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in l.items" :key="item.id">
              <td class="box">☐</td>
              <td>{{ nameOf(item.id) }}</td>
              <td class="id">{{ item.id }}</td>
              <td class="num">{{ item.count.toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>
        <p class="foot">MineCircuit（非公式ツール）で作成</p>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.build-checklist {
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

button {
  padding: 1px 8px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

button:disabled {
  cursor: default;
  opacity: 0.5;
}

.layer-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 6px;
}

.done {
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
}

.nav {
  display: inline-flex;
  gap: 4px;
}

.items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 2px;
}

.items li {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 1px 4px;
  font-size: 12px;
}

.items.finished li {
  opacity: 0.55;
  text-decoration: line-through;
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

.progress,
.summary,
.note {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}

.note {
  opacity: 0.75;
}

.clear {
  justify-self: start;
}
</style>

<style>
/* 印刷の表。画面では出さず、印刷のときはアプリの代わりにこれだけを出す */
.print-sheet {
  display: none;
}

@media print {
  #app {
    display: none !important;
  }

  .print-sheet {
    display: block;
    color: #000;
    background: #fff;
    font-size: 11pt;
  }

  .print-sheet h1 {
    font-size: 14pt;
    margin: 0 0 4pt;
  }

  .print-sheet table {
    width: 100%;
    margin: 10pt 0 0;
    border-collapse: collapse;
    table-layout: fixed;
    break-inside: avoid;
  }

  .print-sheet .name {
    width: 45%;
  }

  .print-sheet caption {
    text-align: left;
    font-weight: bold;
    padding-bottom: 2pt;
  }

  .print-sheet th,
  .print-sheet td {
    border: 0.5pt solid #888;
    padding: 2pt 4pt;
    text-align: left;
  }

  .print-sheet .box {
    width: 2em;
    text-align: center;
  }

  .print-sheet .num {
    width: 4em;
    text-align: right;
  }

  .print-sheet .id {
    font-size: 9pt;
    color: #444;
  }

  .print-sheet .foot {
    margin-top: 10pt;
    font-size: 9pt;
    color: #444;
  }
}
</style>
