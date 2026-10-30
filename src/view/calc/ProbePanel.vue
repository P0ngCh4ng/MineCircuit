<script setup lang="ts">
// 右パネルのプローブ（#31）。マウスの下（なければクリックした）ブロックの回転数・応力などを、値だけ一時的に出す。
// 出どころ・ネットワーク・問題は、ブロックを選んで「選択中のブロック」の欄で見る（#158）。
// クリックしたブロックのネットワークを強調していれば、その数と解除のボタンを出す。
import { computed } from 'vue'
import { useDocumentSession } from '../document/documentSession'
import { useCalcStore } from '../stores/calcStore'
import { useProbeStore } from '../stores/probeStore'
import { useToolStore } from '../stores/toolStore'
import { formatPos } from './probeModel'

const tools = useToolStore()
const probe = useProbeStore()
const calc = useCalcStore()
const session = useDocumentSession()

const visible = computed(() => tools.activeToolId === 'probe' || probe.probedPos !== null)

const blockId = computed(() => {
  void session.version.value
  const pos = probe.shownPos
  const bp = session.current.value?.blueprint
  return pos && bp ? (bp.get(pos)?.id.toString() ?? null) : null
})

/** プラグインをまたいで、値を1列に並べる */
const values = computed(() => probe.readings.flatMap((r) => r.values.map((item) => ({ pluginId: r.pluginId, item }))))

const emptyText = computed(() => {
  if (!calc.hasBlueprint) return '設計図を開くと、ブロックの回転数と応力を見られます。'
  if (!probe.shownPos) return 'ブロックにマウスを重ねると、回転数と応力が出ます。クリックすると、つながったブロックを強調します。'
  if (calc.outcomes === null) return '計算が終わると値が出ます。'
  if (probe.readings.length === 0) return 'このブロックには計算の値がありません。回転でつながるブロックではないか、計算できるプラグインがありません。'
  return null
})
</script>

<template>
  <section v-if="visible" class="probe-panel" aria-label="プローブ" data-testid="probe-panel">
    <h2>プローブ</h2>
    <p v-if="probe.shownPos" class="target">
      <span class="pos">{{ formatPos(probe.shownPos) }}</span>
      <span v-if="blockId" class="id">{{ blockId }}</span>
    </p>
    <p v-if="emptyText" class="empty">{{ emptyText }}</p>
    <ul v-if="values.length > 0" class="values">
      <li v-for="(v, i) in values" :key="i" :data-plugin="v.pluginId">
        <span class="label">{{ v.item.label }}</span>
        {{ v.item.value.value }}
      </li>
    </ul>
    <p v-if="probe.probedPos" class="network" data-testid="probe-network">
      <span v-if="probe.networkPositions">
        {{ formatPos(probe.probedPos) }} とつながった {{ probe.networkPositions.length }} ブロックを強調中
      </span>
      <span v-else>{{ formatPos(probe.probedPos) }} は回転でつながるブロックではありません</span>
      <button type="button" data-action="clear-probe" @click="probe.clear()">強調を解除</button>
    </p>
  </section>
</template>

<style scoped>
.probe-panel {
  display: grid;
  gap: 4px;
  padding: 8px 12px;
  border-top: 1px solid var(--line);
  font-size: 12px;
}

h2 {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  opacity: 0.75;
}

.target {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
}

.pos {
  font-family: ui-monospace, monospace;
}

.id {
  opacity: 0.8;
  word-break: break-all;
}

.empty {
  opacity: 0.7;
  margin: 0;
  line-height: 1.5;
}

.values {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 1px;
  font-variant-numeric: tabular-nums;
}

.label {
  opacity: 0.7;
  margin-right: 6px;
}

.network {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
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
</style>
