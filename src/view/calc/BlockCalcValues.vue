<script setup lang="ts">
// 選択中のブロックの計算の値（#158）。docs/ui.md「右パネル」。
// 回転数・応力など（出どころの印つき）、属するネットワーク、そのブロックの問題を出す。
import { computed } from 'vue'
import { PROVENANCE_LABELS } from '../../calc/provenance'
import type { Vec3 } from '../../domain/vec3'
import { useCalcStore } from '../stores/calcStore'
import { useProbeStore } from '../stores/probeStore'
import { issuesAt, networkRowsAt, probeAt } from './probeModel'
import { SEVERITY_LABELS } from './severityLabels'

const props = defineProps<{ pos: Vec3 }>()

const calc = useCalcStore()
const probe = useProbeStore()

const readings = computed(() => probeAt(calc.outcomes, props.pos))
const networks = computed(() => networkRowsAt(calc.outcomes, props.pos))
const issues = computed(() => issuesAt(calc.outcomes, props.pos))

const emptyText = computed(() => {
  if (calc.outcomes === null) return '計算が終わると、回転数や応力が出ます。'
  if (readings.value.length === 0 && issues.value.length === 0) return 'このブロックには計算の値がありません。'
  return null
})
</script>

<template>
  <div class="block-calc" data-testid="block-calc">
    <div class="calc-head">計算</div>
    <p v-if="emptyText" class="note">{{ emptyText }}</p>

    <dl v-for="r in readings" :key="r.pluginId" class="kv" :data-plugin="r.pluginId">
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

    <!-- ネットワークの値はプラグインの値（上）とネット一覧のタブにあるので、ここは名前と強調だけ -->
    <div v-for="n in networks" :key="n.pluginId" class="network" data-testid="block-network" :title="n.row.value.value">
      <span class="network-name">{{ n.row.label }}</span>に入っています
      <button type="button" class="small" data-action="highlight-network" @click="probe.setProbed(pos)">強調</button>
    </div>

    <ul v-if="issues.length > 0" class="issues" aria-label="このブロックの問題">
      <li v-for="(issue, i) in issues" :key="i" :data-severity="issue.severity">
        <span class="severity" :data-severity="issue.severity">{{ SEVERITY_LABELS[issue.severity] }}</span>
        {{ issue.message }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.block-calc {
  display: grid;
  gap: 6px;
  font-size: 12px;
}

.calc-head {
  font-weight: 600;
}

.kv {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 2px 10px;
  margin: 0;
}

.kv dt {
  opacity: 0.7;
}

.kv dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.source {
  font-size: 10px;
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
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.network-name {
  font-weight: 600;
}

.network .small {
  margin-left: 4px;
}

.small {
  padding: 0 8px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.issues {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  line-height: 1.5;
}

.severity {
  font-size: 10px;
  font-weight: 600;
  padding: 0 4px;
  border: 1px solid currentcolor;
  border-radius: 3px;
}

.severity[data-severity='error'] {
  color: #c62828;
}

.severity[data-severity='warning'] {
  color: #b26a00;
}

.severity[data-severity='info'] {
  color: #2f6fd0;
}

.note {
  margin: 0;
  line-height: 1.5;
  opacity: 0.75;
}
</style>
