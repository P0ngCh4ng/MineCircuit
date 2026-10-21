<script setup lang="ts">
// 選んだ Modpack の jar の読み込みの進み具合と結果を出す部品
import { computed } from 'vue'
import { useModpackContentStore } from './stores/modpackContent'

const content = useModpackContentStore()

const summary = computed(() => {
  const pack = content.pack
  if (!pack) return null
  const packs = pack.langPacks.length > 0 ? `リソースパックなど ${pack.langPacks.length} 個の翻訳も読みました。` : ''
  return `Mod ${pack.mods.length} 個（jar ${pack.jarCount} 個）を読みました。${packs}表示名は日本語 ${pack.displayNameCount('ja_jp')} 件、英語 ${pack.displayNameCount('en_us')} 件です。`
})
</script>

<template>
  <section v-if="content.phase !== 'idle'" class="modpack-load" aria-label="Modpack の読み込み">
    <template v-if="content.phase === 'loading'">
      <p class="note" role="status">
        Mod の jar と翻訳を読んでいます
        <template v-if="content.progress">
          （{{ content.progress.done }} / {{ content.progress.total }}<template v-if="content.progress.current">：{{ content.progress.current }}</template>）
        </template>
      </p>
      <progress
        :value="content.progress?.done ?? 0"
        :max="Math.max(content.progress?.total ?? 1, 1)"
        aria-label="読み込みの進み具合"
      />
    </template>
    <p v-else-if="content.phase === 'loaded' && summary" class="note" role="status">{{ summary }}</p>
    <p v-else-if="content.phase === 'error'" class="note error" role="alert">{{ content.message }}</p>
    <details v-if="content.pack && content.pack.problems.length > 0" class="note">
      <summary>読めなかったファイルが {{ content.pack.problems.length }} 個あります（ほかの Mod は使えます）</summary>
      <ul>
        <li v-for="(p, i) in content.pack.problems" :key="i">{{ p.jar }}：{{ p.message }}</li>
      </ul>
    </details>
  </section>
</template>

<style scoped>
.modpack-load {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 480px;
}

.note {
  margin: 0;
  font-size: 12px;
  opacity: 0.8;
}

.error {
  opacity: 1;
}

progress {
  width: 100%;
}
</style>
