<script setup lang="ts">
// 上のバー。docs/ui.md「全体の配置」の「上のバー1段目・2段目」
import BlueprintFacts from '../document/BlueprintFacts.vue'
import NewBlueprintButton from '../document/NewBlueprintButton.vue'
import OpenFileButton from '../document/OpenFileButton.vue'
import ExportButton from '../edit/ExportButton.vue'
import ModpackLoadStatus from '../ModpackLoadStatus.vue'
import ModpackPicker from '../ModpackPicker.vue'
import { useModpackStore } from '../stores/modpack'
import { useModpackContentStore } from '../stores/modpackContent'
import VanillaAssetsStatus from '../VanillaAssetsStatus.vue'
import ViewControls from './ViewControls.vue'

const modpack = useModpackStore()
const content = useModpackContentStore()
</script>

<template>
  <header class="top-bar">
    <!-- 1段目：設計図（新規・開く・書き出し）、Modpack、設計図の情報 -->
    <div class="row">
      <span class="brand">MineCircuit</span>
      <div class="bar-group">
        <span class="bar-label">設計図</span>
        <NewBlueprintButton />
        <OpenFileButton />
        <ExportButton />
      </div>
      <details class="modpack">
        <summary>
          <span class="bar-label">Modpack</span>
          {{ modpack.selected?.name ?? '使わない' }}
          <template v-if="content.phase === 'loading'">（読み込み中）</template>
        </summary>
        <div class="modpack-body">
          <ModpackPicker />
          <ModpackLoadStatus />
          <VanillaAssetsStatus />
        </div>
      </details>
      <div class="spacer"></div>
      <BlueprintFacts />
    </div>
    <!-- 2段目：表示の操作と編集 -->
    <ViewControls class="row controls" />
  </header>
</template>

<style scoped>
.top-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 20px;
}

.controls {
  padding-top: 6px;
  border-top: 1px solid var(--line);
}

.brand {
  font-weight: bold;
  font-size: 15px;
}

.spacer {
  flex: 1;
}

.modpack {
  position: relative;
}

.modpack summary {
  cursor: pointer;
}

.modpack-body {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 10;
  width: min(480px, 90vw);
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: Canvas;
  box-shadow: 0 2px 8px rgb(0 0 0 / 25%);
}
</style>
