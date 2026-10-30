<script setup lang="ts">
// 下の状態表示。マウス位置、選択中のブロック、計算の問題の件数（#159）、注意書き
import { computed } from 'vue'
import { ISSUE_SEVERITIES } from '../../calc/calcPlugin'
import type { Vec3 } from '../../domain/vec3'
import { SEVERITY_LABELS } from '../calc/severityLabels'
import { fileHandlingNotice } from '../platform/fileAccess'
import { useBrushStore } from '../stores/brushStore'
import { useCalcStore } from '../stores/calcStore'
import { useToolStore } from '../stores/toolStore'

const tools = useToolStore()
const brush = useBrushStore()
const calc = useCalcStore()

function formatPos(pos: Vec3 | null): string {
  return pos ? `${pos.join(', ')}（段 ${pos[1] + 1}）` : '–'
}

const hover = computed(() => formatPos(tools.hoverTarget?.pos ?? null))
const selected = computed(() => formatPos(tools.selectedPos))
/** ブラウザ版とデスクトップ版で違う */
const notice = fileHandlingNotice()
</script>

<template>
  <footer class="status-bar">
    <span>マウス位置 <b data-status="hover">{{ hover }}</b></span>
    <span>選択 <b data-status="selected">{{ selected }}</b></span>
    <!-- 設計図を開いている間は、0 件でも重さごとの件数を出す -->
    <span v-if="calc.hasBlueprint" class="issues" data-status="issues" title="右パネルの計算の「問題」のタブに一覧があります">
      問題
      <b
        v-for="s in ISSUE_SEVERITIES"
        :key="s"
        class="count"
        :class="{ some: calc.issueCounts[s] > 0 }"
        :data-severity="s"
      >{{ SEVERITY_LABELS[s] }} {{ calc.issueCounts[s] }}</b>
    </span>
    <span v-if="brush.message" data-status="message" role="status">{{ brush.message }}</span>
    <span class="spacer"></span>
    <span class="notice">
      {{ notice }}非公式ツールです。Mojang Studios・Microsoft および各 Mod の作者とは関係ありません。
    </span>
  </footer>
</template>

<style scoped>
.status-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 18px;
  padding: 4px 12px;
  border-top: 1px solid var(--line);
  background: var(--panel);
  font-size: 12px;
}

b {
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.issues {
  display: inline-flex;
  gap: 8px;
}

.count[data-severity='error'].some {
  color: #c62828;
}

.count[data-severity='warning'].some {
  color: #b26a00;
}

.count[data-severity='info'].some {
  color: #2f6fd0;
}

.spacer {
  flex: 1;
}

.notice {
  opacity: 0.75;
}
</style>
