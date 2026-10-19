<script setup lang="ts">
// 左パネルの「使っているMod」。namespace ごとのブロック数と、Modpack に足りない Mod の警告（#26）
import { computed } from 'vue'
import { useDocumentSession } from '../document/documentSession'
import { useModpackContentStore } from '../stores/modpackContent'
import { useMissingMods } from './useMissingMods'

const session = useDocumentSession()
const content = useModpackContentStore()
const { usage, missingNamespaces } = useMissingMods()

const hasBlueprint = computed(() => session.current.value !== null)

const note = computed(() => {
  if (!hasBlueprint.value) return '設計図を開くと、使っている Mod が出ます。'
  if (usage.value.length === 0) return 'ブロックが置かれていません。'
  switch (content.phase) {
    case 'idle':
      return 'Modpack を選ぶと、足りない Mod を調べます。'
    case 'loading':
      return 'Modpack を読んでいます。読み終わると、足りない Mod を調べます。'
    case 'error':
      return 'Modpack を読めなかったので、足りない Mod は調べていません。'
    case 'loaded':
      return missingNamespaces.value.length === 0 ? 'すべて Modpack に入っています。' : null
  }
  return null
})
</script>

<template>
  <section class="used-mods" aria-labelledby="used-mods-heading">
    <h2 id="used-mods-heading">使っているMod</h2>
    <p v-if="missingNamespaces.length > 0" class="warning" role="alert">
      Modpack にない Mod が {{ missingNamespaces.length }} 個あります。この Modpack では、これらのブロックは置かれません。
    </p>
    <ul v-if="usage.length > 0" class="ns-list">
      <li v-for="u in usage" :key="u.namespace" :class="{ missing: u.missing }" :data-namespace="u.namespace">
        <span class="ns">{{ u.namespace }}</span>
        <span v-if="u.missing" class="badge">足りない</span>
        <span class="count">{{ u.blockCount.toLocaleString() }}</span>
      </li>
    </ul>
    <p v-if="note" class="note">{{ note }}</p>
  </section>
</template>

<style scoped>
.used-mods {
  display: grid;
  gap: 6px;
}

h2 {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  opacity: 0.75;
}

.ns-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 2px;
}

.ns-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.ns {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.count {
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

.missing .ns,
.badge,
.warning {
  color: light-dark(#b0541e, #e08a52);
}

.badge {
  font-size: 11px;
  border: 1px solid currentColor;
  border-radius: 3px;
  padding: 0 4px;
}

.warning,
.note {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}

.note {
  opacity: 0.75;
}
</style>
