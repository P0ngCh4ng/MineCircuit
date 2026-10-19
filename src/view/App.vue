<script setup lang="ts">
// 画面の部品は後の Issue で足す
import CalcPanel from './CalcPanel.vue'
import ModpackPicker from './ModpackPicker.vue'
import { useToolStore } from './stores/toolStore'
import ToolBar from './tools/ToolBar.vue'
import { useKeyboardShortcuts } from './tools/useKeyboardShortcuts'

const tools = useToolStore()
useKeyboardShortcuts({
  tool: (a) => tools.setTool(a.id),
  clearSelection: () => tools.setSelected(null),
})
</script>

<template>
  <main class="app">
    <h1>MineCircuit</h1>
    <p class="notice">非公式ツールです。Mojang Studios および各 Mod の作者とは関係ありません。</p>
    <ModpackPicker />
    <!-- 表示部分。3D/2D表示（#9, #14）はここに入れる -->
    <section class="viewport" aria-label="表示">
      <ToolBar class="viewport-tools" />
    </section>
    <!-- 右パネル。選択中のブロックの情報は後の Issue で足す -->
    <aside class="right-panel" aria-label="右パネル">
      <CalcPanel />
    </aside>
  </main>
</template>

<style scoped>
.app {
  padding: 16px;
}

.notice {
  font-size: 12px;
  opacity: 0.7;
}

.viewport {
  position: relative;
  min-height: 320px;
}

.viewport-tools {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 1;
}
</style>
