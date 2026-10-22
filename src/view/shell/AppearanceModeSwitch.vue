<script setup lang="ts">
// 「テクスチャ／色」の切り替え（上のバー2段目。#85）。docs/design.md「見た目（モデルとテクスチャ）」。
// 見た目（Modpack のモデルとテクスチャ）がないときは色で描き、切り替えは押せない
import { computed } from 'vue'
import { useAppearanceStore, type AppearanceMode } from '../stores/appearanceStore'

const appearance = useAppearanceStore()

const modes: readonly { id: AppearanceMode; label: string; title: string }[] = [
  { id: 'texture', label: 'テクスチャ', title: 'Modpack のモデルとテクスチャで描く' },
  { id: 'color', label: '色', title: 'ブロックの種類ごとに決めた色で描く' },
]

/** 切り替えられないときの説明。押せるときは null */
const unavailableNote = computed(() => {
  if (appearance.loading) return 'ブロックの見た目を読み込んでいます。'
  if (appearance.error) return appearance.error
  if (!appearance.available) return 'Modpack を選ぶと、テクスチャで描けます。'
  return null
})

const status = computed(() => {
  if (appearance.loading) return '読み込み中…'
  if (appearance.problemCount > 0) return `読めないもの ${appearance.problemCount} 件`
  return null
})
</script>

<template>
  <div class="bar-group" role="group" aria-label="ブロックの描き方" :title="unavailableNote ?? undefined">
    <span class="bar-label">描き方</span>
    <button
      v-for="m in modes"
      :key="m.id"
      type="button"
      :data-appearance-mode="m.id"
      :title="unavailableNote ?? m.title"
      :aria-pressed="appearance.effectiveMode === m.id"
      :disabled="!appearance.available"
      @click="appearance.setMode(m.id)"
    >
      {{ m.label }}
    </button>
    <span
      v-if="status"
      class="appearance-status"
      data-testid="appearance-status"
      :title="appearance.problemCount > 0 ? 'モデルやテクスチャのファイルを読めなかったブロックは、紫と黒の模様か色で描いています。' : undefined"
    >
      {{ status }}
    </span>
  </div>
</template>

<style scoped>
button[aria-pressed='true'] {
  background: color-mix(in srgb, Highlight 22%, Canvas);
  border-color: Highlight;
}

.appearance-status {
  font-size: 12px;
  opacity: 0.75;
  white-space: nowrap;
}
</style>
