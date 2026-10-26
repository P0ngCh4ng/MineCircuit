<script setup lang="ts">
// 表示部分の右下に出す「回転」の色の凡例（#117。docs/ui.md「回転の表示」）
import { ROTATION_COLORS, ROTATION_LEGEND } from './rotationColors'
</script>

<template>
  <div class="rotation-legend" role="note" aria-label="回転の色" data-testid="rotation-legend">
    <span v-for="item in ROTATION_LEGEND" :key="item.key" class="item">
      <span class="swatch" :style="{ background: ROTATION_COLORS[item.key] }" aria-hidden="true"></span>
      {{ item.label }}
    </span>
    <span class="note">中速・高速の境目は Create の設定（初期値 30・100 RPM）。数値はプローブで見る</span>
  </div>
</template>

<style scoped>
.rotation-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  max-width: 340px;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: color-mix(in srgb, Canvas 92%, transparent);
  font-size: 11px;
}

.item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.swatch {
  width: 12px;
  height: 12px;
  border-radius: 2px;
}

.note {
  flex-basis: 100%;
  opacity: 0.7;
}
</style>
