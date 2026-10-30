<script setup lang="ts">
// 表示部分の左下に出す、計測（M）と同じブロック（S）の結果。docs/ui.md「2D表示と計測」「ツール」。
// このストアを作ると2つのツールが使えるようになるので、表示部分にいつも置いておく。
import { computed } from 'vue'
import { countLayers } from '../../analysis/floodSameState'
import type { Vec3 } from '../../domain/vec3'
import { useMeasureStore } from '../stores/measureStore'
import { useToolStore } from '../stores/toolStore'

const tools = useToolStore()
const measures = useMeasureStore()

const tool = computed(() => tools.activeToolId)

function formatPos(p: Vec3): string {
  return `(${p.join(', ')})、段 ${p[1] + 1}`
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n)
}

const first = computed(() => measures.measurePoints[0] ?? null)
const result = computed(() => measures.measurement)
const group = computed(() => measures.sameBlockGroup)
const groupLayers = computed(() => (group.value ? countLayers(group.value.positions) : 0))
</script>

<template>
  <div v-if="tool === 'measure'" class="readout" role="status" aria-live="polite" data-testid="measure-readout">
    <h3>計測</h3>
    <p v-if="!first" class="note">1つ目のブロックをクリックしてください。</p>
    <p v-else-if="!result" class="note">1つ目：{{ formatPos(first) }}。2つ目のブロックをクリックしてください。</p>
    <template v-else>
      <dl>
        <dt>1つ目</dt>
        <dd>{{ formatPos(result.a) }}</dd>
        <dt>2つ目</dt>
        <dd>{{ formatPos(result.b) }}</dd>
        <dt>差</dt>
        <dd data-readout="delta">X {{ signed(result.delta[0]) }}, Y {{ signed(result.delta[1]) }}, Z {{ signed(result.delta[2]) }}</dd>
        <dt>直線距離</dt>
        <dd data-readout="euclidean">{{ result.euclidean.toFixed(2) }} ブロック</dd>
        <dt>軸に沿った距離</dt>
        <dd data-readout="manhattan">{{ result.manhattan }} ブロック（シャフトやベルトを軸に沿って引く長さの目安）</dd>
        <dt>囲む範囲</dt>
        <dd data-readout="bounds">{{ result.boundingSize.join(' × ') }}</dd>
      </dl>
      <p class="note">もう一度クリックすると、新しく測り直します。</p>
    </template>
  </div>

  <div v-else-if="tool === 'sameBlock'" class="readout" role="status" aria-live="polite" data-testid="same-block-readout">
    <h3>同じブロック</h3>
    <p v-if="!group" class="note">ブロックをクリックすると、隣り合う同じ種類のブロックをまとめて強調します。</p>
    <dl v-else>
      <dt>種類</dt>
      <dd data-readout="state">{{ group.state.key }}</dd>
      <dt>個数</dt>
      <dd data-readout="count">{{ group.positions.length.toLocaleString() }} 個</dd>
      <dt>またがる段</dt>
      <dd data-readout="layers">{{ groupLayers }} 段</dd>
    </dl>
    <p class="note">面で隣り合う、同じブロック状態のブロックを集めただけです。回転や配管のつながりではありません。</p>
  </div>
</template>

<style scoped>
.readout {
  max-width: 520px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: Canvas;
  box-shadow: 0 1px 3px rgb(0 0 0 / 20%);
  font-size: 13px;
}

h3 {
  margin: 0 0 4px;
  font-size: 13px;
}

dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 12px;
  margin: 0;
}

dt {
  opacity: 0.7;
}

dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.note {
  margin: 4px 0 0;
  opacity: 0.8;
}

.note:first-of-type {
  margin-top: 0;
}
</style>
