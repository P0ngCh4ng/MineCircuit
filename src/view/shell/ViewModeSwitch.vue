<script setup lang="ts">
// 3D/2D の切り替え（上のバー2段目）。略称の表示は ViewControls の「補助表示」
import { useViewStore, type ViewMode } from '../stores/viewStore'

const viewMode = useViewStore()

const modes: readonly { id: ViewMode; label: string; title: string }[] = [
  { id: '3d', label: '3D', title: '設計図全体を立体で見る' },
  { id: '2d', label: '2D', title: '今の段を真上から見たマス目で見る' },
]
</script>

<template>
  <div class="bar-group" role="group" aria-label="表示の切り替え">
    <span class="bar-label">表示</span>
    <button
      v-for="m in modes"
      :key="m.id"
      type="button"
      :data-view-mode="m.id"
      :title="m.title"
      :aria-pressed="viewMode.mode === m.id"
      @click="viewMode.setMode(m.id)"
    >
      {{ m.label }}
    </button>
  </div>
</template>

<style scoped>
button[aria-pressed='true'] {
  background: color-mix(in srgb, Highlight 22%, Canvas);
  border-color: Highlight;
}
</style>
