<script setup lang="ts">
// 何も選んでいないときの、設計図全体のまとめ（#158）。docs/ui.md「右パネル」。
// 計算のまとめの行（ネット一覧の行は除く）と、重さごとの問題の件数を出す。
import { computed } from 'vue'
import { ISSUE_SEVERITIES } from '../../calc/calcPlugin'
import { PROVENANCE_LABELS } from '../../calc/provenance'
import { useCalcStore } from '../stores/calcStore'
import { SEVERITY_LABELS } from './severityLabels'

const calc = useCalcStore()

const plugins = computed(() =>
  (calc.outcomes ?? []).flatMap((o) =>
    o.status === 'ok'
      ? [{ pluginId: o.pluginId, label: o.label, rows: o.result.summary.filter((item) => !item.network) }]
      : [],
  ),
)
</script>

<template>
  <div class="blueprint-calc" data-testid="blueprint-calc">
    <div class="calc-head">設計図全体</div>
    <p v-if="calc.outcomes === null" class="note">計算が終わると、ここにまとめが出ます。</p>
    <template v-else>
      <dl class="kv">
        <dt>問題</dt>
        <dd data-detail="issue-counts">
          <span v-for="s in ISSUE_SEVERITIES" :key="s" class="count" :data-severity="s">
            {{ SEVERITY_LABELS[s] }} {{ calc.issueCounts[s] }}
          </span>
        </dd>
      </dl>
      <dl v-for="p in plugins" :key="p.pluginId" class="kv" :data-plugin="p.pluginId">
        <template v-for="(item, i) in p.rows" :key="i">
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
    </template>
  </div>
</template>

<style scoped>
.blueprint-calc {
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

.count + .count {
  margin-left: 8px;
}

.source {
  font-size: 10px;
  padding: 0 4px;
  border: 1px solid currentcolor;
  border-radius: 3px;
  opacity: 0.7;
  white-space: nowrap;
}

.note {
  margin: 0;
  line-height: 1.5;
  opacity: 0.75;
}
</style>
