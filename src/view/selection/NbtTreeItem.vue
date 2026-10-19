<script setup lang="ts">
// 生データのツリーの1行。Compound とリストは折りたためる（中身はこの部品をくり返す）
import type { NbtTreeNode } from './nbtTree'
import NbtTreeItem from './NbtTreeItem.vue'

defineProps<{
  node: NbtTreeNode
  /** 一番上からの深さ。浅いところだけ最初から開く */
  depth: number
}>()
</script>

<template>
  <li class="item" :data-label="node.label" :data-type="node.type">
    <details v-if="node.children" :open="depth < 1">
      <summary>
        <span class="k">{{ node.label }}</span>
        <span class="t">{{ node.typeLabel }}</span>
        <span class="n">{{ node.text }}</span>
      </summary>
      <ul v-if="node.children.length > 0" class="children">
        <NbtTreeItem v-for="(child, i) in node.children" :key="i" :node="child" :depth="depth + 1" />
      </ul>
      <p v-else class="empty">（空）</p>
    </details>
    <div v-else class="leaf">
      <span class="k">{{ node.label }}</span>
      <span class="t">{{ node.typeLabel }}</span>
      <span class="v">{{ node.text }}</span>
    </div>
  </li>
</template>

<style scoped>
.item {
  list-style: none;
}

summary {
  cursor: pointer;
}

.leaf {
  /* summary の三角の分だけ字下げしてそろえる */
  padding-left: 1.1em;
}

.children {
  margin: 0;
  padding: 0 0 0 12px;
  border-left: 1px solid var(--line);
}

.k {
  font-weight: 600;
}

.t {
  margin-left: 6px;
  font-size: 10px;
  opacity: 0.6;
}

.n {
  margin-left: 6px;
  opacity: 0.6;
}

.v {
  margin-left: 6px;
  overflow-wrap: anywhere;
}

.empty {
  margin: 0;
  padding-left: 12px;
  opacity: 0.6;
}
</style>
