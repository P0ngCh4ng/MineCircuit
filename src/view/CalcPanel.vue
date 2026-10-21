<script setup lang="ts">
// 右パネルの計算結果。プラグインごとに、合計・問題・仮定を出す。
// 問題と仮定の位置をクリックすると、そのブロックを選択し、その段へ移ってネットワークを強調する（#31）。
import { computed } from 'vue'
import { PROVENANCE_LABELS } from '../calc/provenance'
import { formatPos } from './calc/probeModel'
import { useJumpTo } from './calc/useProbeTool'
import { useCalcStore } from './stores/calcStore'

const calc = useCalcStore()
const jumpTo = useJumpTo()

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

</script>

<template>
  <section class="calc-panel" aria-label="計算結果">
    <h2>計算結果</h2>
    <p v-if="statusText" class="status" role="status">{{ statusText }}</p>
    <p v-if="calc.error" class="error" role="alert">{{ calc.error }}</p>

    <p v-if="!calc.hasBlueprint" class="empty">設計図を開くと、ここに計算結果が出ます。</p>
    <template v-else-if="calc.outcomes">
      <p v-if="calc.outcomes.length === 0" class="empty">この設計図を計算できるプラグインはありません。</p>
      <article v-for="o in calc.outcomes" :key="o.pluginId" class="plugin" :data-plugin="o.pluginId">
        <h3>{{ o.label }}</h3>
        <p v-if="o.status === 'error'" class="error">{{ o.message }}</p>
        <template v-else>
          <dl v-if="o.result.summary.length > 0" class="summary">
            <template v-for="(item, i) in o.result.summary" :key="i">
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

          <h4>問題（{{ o.result.issues.length }}）</h4>
          <p v-if="o.result.issues.length === 0" class="none">問題はありません。</p>
          <ul v-else class="issues">
            <li v-for="(issue, i) in o.result.issues" :key="i">
              <button type="button" class="pos" :title="`${formatPos(issue.pos)} へ移る`" @click="jumpTo(issue.pos)">{{ formatPos(issue.pos) }}</button>
              {{ issue.message }}
            </li>
          </ul>

          <h4>仮定（{{ o.result.assumptions.length }}）</h4>
          <p v-if="o.result.assumptions.length === 0" class="none">仮定はありません。</p>
          <ul v-else class="assumptions">
            <li v-for="(a, i) in o.result.assumptions" :key="i">
              <button v-if="a.pos" type="button" class="pos" :title="`${formatPos(a.pos)} へ移る`" @click="jumpTo(a.pos)">{{ formatPos(a.pos) }}</button>
              {{ a.message }}
            </li>
          </ul>
        </template>
      </article>
    </template>
  </section>
</template>

<style scoped>
.calc-panel {
  font-size: 13px;
}

h2 {
  font-size: 14px;
  margin: 0 0 8px;
}

h3 {
  font-size: 13px;
  margin: 12px 0 4px;
}

h4 {
  font-size: 12px;
  margin: 8px 0 2px;
}

.status,
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

.pos {
  font: inherit;
  font-family: ui-monospace, monospace;
  padding: 0 2px;
  cursor: pointer;
}
</style>
