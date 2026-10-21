<script setup lang="ts">
// 右パネルのプローブ（#31）。マウスの下（なければクリックした）ブロックの回転数・応力などを、出どころ付きで出す。
// クリックしたブロックのネットワークを強調していれば、その数と解除のボタンを出す。
import { computed } from 'vue'
import { PROVENANCE_LABELS } from '../../calc/provenance'
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
    <article v-for="r in probe.readings" :key="r.pluginId" class="reading" :data-plugin="r.pluginId">
      <h3>{{ r.pluginLabel }}</h3>
      <dl>
        <template v-for="(item, i) in r.values" :key="i">
          <dt>{{ item.label }}</dt>
          <dd>
            {{ item.value.value }}
            <span
              class="source"
              :data-source="item.value.source"
              :title="item.value.note ?? PROVENANCE_LABELS[item.value.source]"
            >{{ PROVENANCE_LABELS[item.value.source] }}</span>
          </dd>
        </template>
      </dl>
    </article>
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
  font-size: 13px;
  margin-bottom: 16px;
}

h2 {
  font-size: 14px;
  margin: 0 0 8px;
}

h3 {
  font-size: 13px;
  margin: 8px 0 4px;
}

.target {
  margin: 0 0 4px;
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
  margin: 4px 0;
}

dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 8px;
  margin: 0;
}

dd {
  margin: 0;
}

.source {
  font-size: 11px;
  padding: 0 4px;
  border: 1px solid currentcolor;
  border-radius: 3px;
  opacity: 0.7;
  white-space: nowrap;
}

.source[data-source='assumed'] {
  color: #b26a00;
  opacity: 1;
}

.source[data-source='virtual'] {
  color: #8a4fd8;
  opacity: 1;
}

.network {
  margin: 8px 0 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}
</style>
