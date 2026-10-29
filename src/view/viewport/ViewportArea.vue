<script setup lang="ts">
// 表示部分。docs/ui.md「全体の配置」の「表示部分」。
// 3D表示（#9）と2D表示（#14）はこの部品の中に置く。左上に縦のツールバー、左下に結果の表示。
import MeasureReadout from '../analysis/MeasureReadout.vue'
import { useDocumentSession } from '../document/documentSession'
import { useFileDrop } from '../document/useFileDrop'
import { confirmDiscard } from '../document/unsavedChanges'
import { useViewStore } from '../stores/viewStore'
import ToolBar from '../tools/ToolBar.vue'
import LayerView2D from './LayerView2D.vue'
import RotationLegend from './RotationLegend.vue'
import Viewport3D from './Viewport3D.vue'

const session = useDocumentSession()
const { current, opening, error } = session
const view = useViewStore()
const drop = useFileDrop((file) => {
  if (confirmDiscard(session)) void session.openFile(file)
})
</script>

<template>
  <section
    class="viewport"
    aria-label="表示"
    data-testid="viewport"
    @dragenter="drop.onDragEnter"
    @dragover="drop.onDragOver"
    @dragleave="drop.onDragLeave"
    @drop="drop.onDrop"
  >
    <!-- 3D表示（#9）と2D表示（#14）。current が null の間は出さない -->
    <Viewport3D v-if="current && view.mode === '3d'" class="viewport-3d" />
    <LayerView2D v-if="current && view.mode === '2d'" :show-grid="view.showGrid" />

    <div v-if="!current" class="empty">
      <p v-if="opening">設計図を読んでいます…</p>
      <template v-else>
        <p class="empty-title">設計図（.nbt）を開いてください</p>
        <p>上の「ファイルを開く…」を押すか、ここにファイルを落とします。</p>
      </template>
    </div>

    <ToolBar class="viewport-tools" />

    <!-- 左下の結果の表示。計測（#16）や書き出し（#21）のお知らせもここに足す -->
    <div class="readouts">
      <MeasureReadout />
      <div v-if="error" class="error" role="alert">
        <span>{{ error }}</span>
        <button type="button" @click="session.clearError()">閉じる</button>
      </div>
    </div>

    <!-- 回転の表示の凡例（#117） -->
    <RotationLegend v-if="current && view.showRotation" class="rotation-legend" />

    <div v-if="drop.dragging.value" class="drop" aria-hidden="true">ここに落として設計図を開く</div>
  </section>
</template>

<style scoped>
.viewport {
  position: relative;
  min-height: 0;
  overflow: hidden;
  background: color-mix(in srgb, CanvasText 6%, Canvas);
}

.viewport-3d {
  z-index: 0;
}

.rotation-legend {
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 2;
}

.viewport-tools {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
}

.empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  padding: 16px;
  text-align: center;
  opacity: 0.8;
}

.empty p {
  margin: 4px 0;
}

.empty-title {
  font-size: 18px;
  font-weight: bold;
}

.readouts {
  position: absolute;
  left: 56px;
  bottom: 8px;
  right: 8px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  pointer-events: none;
}

.readouts > * {
  pointer-events: auto;
}

.error {
  display: flex;
  gap: 12px;
  align-items: center;
  max-width: 640px;
  padding: 8px 12px;
  border: 1px solid #c62828;
  border-radius: 6px;
  background: Canvas;
  box-shadow: 0 1px 3px rgb(0 0 0 / 25%);
}

.drop {
  position: absolute;
  inset: 12px;
  z-index: 3;
  display: grid;
  place-items: center;
  border: 2px dashed Highlight;
  border-radius: 10px;
  background: color-mix(in srgb, Highlight 12%, transparent);
  font-weight: bold;
  pointer-events: none;
}
</style>
