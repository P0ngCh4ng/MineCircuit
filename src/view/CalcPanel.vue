<script setup lang="ts">
// 右パネルの下「計算」（#157）。docs/ui.md「右パネル」。
// まとめ・ネットワーク・問題・入出力・仮定のタブに分け、プラグインごとに出す。
// 問題と仮定の位置をクリックすると、そのブロックを選択し、その段へ移ってネットワークを強調する（#31）。
// 位置のある合計の行（ネット一覧の行 #152、生産ラインの行 #168）も、押すと同じようにその位置へ移る。
import { computed, ref, watch } from 'vue'
import { ISSUE_SEVERITIES, issueSeverity, type CalcSummaryItem } from '../calc/calcPlugin'
import { PROVENANCE_LABELS } from '../calc/provenance'
import PortPanel from './calc/PortPanel.vue'
import { formatPos } from './calc/probeModel'
import { SEVERITY_LABELS } from './calc/severityLabels'
import { useJumpTo } from './calc/useProbeTool'
import { useCalcStore } from './stores/calcStore'
import { usePortStore } from './stores/portStore'
import { useToolStore } from './stores/toolStore'

type CalcTab = 'summary' | 'networks' | 'issues' | 'ports' | 'assumptions'

const calc = useCalcStore()
const ports = usePortStore()
const tools = useToolStore()
const jumpTo = useJumpTo()

const tab = ref<CalcTab>('summary')

// 仮の入出力のツールに替えたら、置く種類と一覧のある「入出力」のタブを開く
watch(
  () => tools.activeToolId,
  (id) => {
    if (id === 'port') tab.value = 'ports'
  },
  { immediate: true },
)

const statusText = computed(() => {
  switch (calc.status) {
    case 'waiting':
      return '変更が止まったら計算します'
    case 'running':
      return '計算中'
    default:
      return null
  }
})

/** 計算できたプラグインの合計を、まとめの行とネットワークの行（ネット一覧）に分けたもの */
const plugins = computed(() =>
  (calc.outcomes ?? []).map((o) => {
    const summary: readonly CalcSummaryItem[] = o.status === 'ok' ? o.result.summary : []
    const issues = o.status === 'ok' ? o.result.issues : []
    return {
      outcome: o,
      totals: summary.filter((item) => !item.network),
      networks: summary.filter((item) => item.network),
      issues,
      // 問題は重さごとに分け、重い順に出す（#159）
      issueGroups: ISSUE_SEVERITIES.map((severity) => ({
        severity,
        items: issues.filter((i) => issueSeverity(i) === severity),
      })).filter((g) => g.items.length > 0),
      assumptions: o.status === 'ok' ? o.result.assumptions : [],
    }
  }),
)

function total(pick: (p: (typeof plugins.value)[number]) => readonly unknown[]): number {
  return plugins.value.reduce((n, p) => n + pick(p).length, 0)
}

const tabs = computed<{ id: CalcTab; label: string }[]>(() => [
  { id: 'summary', label: 'まとめ' },
  { id: 'networks', label: `ネットワーク（${total((p) => p.networks)}）` },
  { id: 'issues', label: `問題（${total((p) => p.issues)}）` },
  { id: 'ports', label: `入出力（${ports.ports.length}）` },
  { id: 'assumptions', label: `仮定（${total((p) => p.assumptions)}）` },
])
</script>

<template>
  <section class="calc-panel" aria-labelledby="calc-panel-heading">
    <div class="head">
      <h2 id="calc-panel-heading">計算</h2>
      <p v-if="statusText" class="status" role="status">{{ statusText }}</p>
    </div>
    <div class="tabs" role="tablist" aria-label="計算の表示">
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        role="tab"
        class="tab"
        :data-tab="t.id"
        :aria-selected="tab === t.id"
        @click="tab = t.id"
      >{{ t.label }}</button>
    </div>

    <div class="body">
      <p v-if="calc.error" class="error" role="alert">{{ calc.error }}</p>

      <!-- 入出力は計算の結果がなくても出す（置く種類と一覧） -->
      <div v-show="tab === 'ports'" role="tabpanel" data-tabpanel="ports">
        <PortPanel />
      </div>

      <div v-show="tab !== 'ports'">
        <p v-if="!calc.hasBlueprint" class="empty">設計図を開くと、ここに計算結果が出ます。</p>
        <p v-else-if="calc.outcomes && plugins.length === 0" class="empty">この設計図を計算できるプラグインはありません。</p>

        <article v-for="p in plugins" :key="p.outcome.pluginId" class="plugin" :data-plugin="p.outcome.pluginId">
          <h3>{{ p.outcome.label }}</h3>
          <p v-if="p.outcome.status === 'error'" class="error">{{ p.outcome.message }}</p>
          <template v-else>
            <div v-show="tab === 'summary'" role="tabpanel" data-tabpanel="summary">
              <p v-if="p.totals.length === 0" class="none">まとめはありません。</p>
              <dl v-else class="summary">
                <template v-for="(item, i) in p.totals" :key="i">
                  <dt>
                    <button
                      v-if="item.pos"
                      type="button"
                      class="net"
                      :title="`${item.label}の位置へ移る（${formatPos(item.pos)}）`"
                      @click="jumpTo(item.pos)"
                    >{{ item.label }}</button>
                    <template v-else>{{ item.label }}</template>
                  </dt>
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
            </div>

            <div v-show="tab === 'networks'" role="tabpanel" data-tabpanel="networks">
              <p v-if="p.networks.length === 0" class="none">ネットワークはありません。</p>
              <dl v-else class="summary networks">
                <template v-for="(item, i) in p.networks" :key="i">
                  <dt>
                    <button
                      v-if="item.pos"
                      type="button"
                      class="net"
                      :title="`${item.label}を強調する（${formatPos(item.pos)}）`"
                      @click="jumpTo(item.pos)"
                    >{{ item.label }}</button>
                  </dt>
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
            </div>

            <div v-show="tab === 'issues'" role="tabpanel" data-tabpanel="issues">
              <p v-if="p.issues.length === 0" class="none">問題はありません。</p>
              <div v-for="g in p.issueGroups" :key="g.severity" class="issue-group" :data-severity="g.severity">
                <h4><span class="severity" :data-severity="g.severity">{{ SEVERITY_LABELS[g.severity] }}</span>（{{ g.items.length }}）</h4>
                <ul class="issues">
                  <li v-for="(issue, i) in g.items" :key="i" :data-severity="g.severity">
                    <button type="button" class="pos" :title="`${formatPos(issue.pos)} へ移る`" @click="jumpTo(issue.pos)">{{ formatPos(issue.pos) }}</button>
                    {{ issue.message }}
                  </li>
                </ul>
              </div>
            </div>

            <div v-show="tab === 'assumptions'" role="tabpanel" data-tabpanel="assumptions">
              <p v-if="p.assumptions.length === 0" class="none">仮定はありません。</p>
              <ul v-else class="assumptions">
                <li v-for="(a, i) in p.assumptions" :key="i">
                  <button v-if="a.pos" type="button" class="pos" :title="`${formatPos(a.pos)} へ移る`" @click="jumpTo(a.pos)">{{ formatPos(a.pos) }}</button>
                  {{ a.message }}
                </li>
              </ul>
            </div>
          </template>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.calc-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  font-size: 13px;
}

.head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 12px 4px;
}

h2 {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  opacity: 0.75;
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 0 8px;
  border-bottom: 1px solid var(--line);
}

.tab {
  margin-bottom: -1px;
  padding: 3px 6px;
  border: 1px solid transparent;
  border-radius: 3px 3px 0 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  opacity: 0.7;
  cursor: pointer;
}

.tab[aria-selected='true'] {
  border-color: var(--line);
  border-bottom-color: var(--panel);
  background: var(--panel);
  font-weight: 600;
  opacity: 1;
}

.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 12px 12px;
}

h3 {
  font-size: 13px;
  margin: 8px 0 4px;
}

h4 {
  font-size: 12px;
  font-weight: normal;
  margin: 6px 0 2px;
}

.status {
  margin: 0;
  font-size: 12px;
  opacity: 0.7;
}

.empty,
.none {
  opacity: 0.7;
  margin: 4px 0;
}

.error {
  color: #c62828;
}

.summary {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 8px;
  margin: 0;
}

.summary dd {
  margin: 0;
}

.source {
  font-size: 11px;
  padding: 0 4px;
  border: 1px solid currentcolor;
  border-radius: 3px;
  opacity: 0.7;
}

.source[data-source='assumed'] {
  color: #b26a00;
  opacity: 1;
}

.source[data-source='virtual'] {
  color: #8a4fd8;
  opacity: 1;
}

ul {
  margin: 0;
  padding-left: 16px;
}

.severity {
  font-size: 11px;
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

.net {
  font: inherit;
  padding: 0 2px;
  cursor: pointer;
  white-space: nowrap;
}

.pos {
  font: inherit;
  font-family: ui-monospace, monospace;
  padding: 0 2px;
  cursor: pointer;
}
</style>
