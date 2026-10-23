<script setup lang="ts">
// 上のバー2段目。docs/ui.md「全体の配置」の並び順で、各 Issue の部品をここに1行ずつ足す。
// 部品は .bar-group / .bar-label（style.css）で囲むと見た目がそろう。
import { computed } from 'vue'
import EditControls from '../edit/EditControls.vue'
import { useDocumentSession } from '../document/documentSession'
import { LAYER_MODES, type LayerMode } from '../layers/layerDisplay'
import { useLayerNavigation } from '../layers/useLayerNavigation'
import { useSearchStore } from '../stores/searchStore'
import { useViewStore } from '../stores/viewStore'
import { CAMERA_VIEWS } from '../viewport/cameraViews'
import AppearanceModeSwitch from './AppearanceModeSwitch.vue'
import ViewModeSwitch from './ViewModeSwitch.vue'

const session = useDocumentSession()
const view = useViewStore()
const search = useSearchStore()
const noBlueprint = computed(() => session.current.value === null)
/** 視点は3D表示だけで使う */
const noCamera = computed(() => noBlueprint.value || view.mode !== '3d')
const nav = useLayerNavigation()
const layerText = computed(() => (nav.height.value > 0 ? `${nav.current.value + 1} / ${nav.height.value}` : '– / –'))

function onModeChange(e: Event): void {
  view.setLayerMode((e.target as HTMLSelectElement).value as LayerMode)
}
</script>

<template>
  <div role="toolbar" aria-label="表示の操作">
    <ViewModeSwitch />
    <AppearanceModeSwitch />
    <div class="bar-group" role="group" aria-label="視点">
      <span class="bar-label">視点</span>
      <button
        v-for="v in CAMERA_VIEWS"
        :key="v.id"
        type="button"
        :data-view="v.id"
        :title="v.title"
        :aria-pressed="view.cameraView === v.id"
        :disabled="noCamera"
        @click="view.setView(v.id)"
      >
        {{ v.label }}
      </button>
      <button type="button" data-view="fit" title="今の向きのまま、設計図全体が入るようにする" :disabled="noCamera" @click="view.fitAll()">
        全体を表示
      </button>
    </div>
    <div class="bar-group" role="group" aria-label="段">
      <span class="bar-label">段</span>
      <button type="button" data-layer="down" title="1つ下の段へ（PageDown）" aria-label="1つ下の段へ" :disabled="!nav.canDown.value" @click="nav.down()">
        ▼
      </button>
      <span class="layer-box" data-testid="layer-current" aria-live="polite">{{ layerText }}</span>
      <button type="button" data-layer="up" title="1つ上の段へ（PageUp）" aria-label="1つ上の段へ" :disabled="!nav.canUp.value" @click="nav.up()">
        ▲
      </button>
      <select aria-label="段の表示方法" title="段の表示方法" :value="view.layerMode" :disabled="noBlueprint" @change="onModeChange">
        <option v-for="m in LAYER_MODES" :key="m.id" :value="m.id" :title="m.title">{{ m.label }}</option>
      </select>
    </div>
    <div class="bar-group" role="group" aria-label="補助表示">
      <span class="bar-label">補助表示</span>
      <button type="button" data-toggle="grid" title="床のマス目を出す（G）" :aria-pressed="view.showGrid" @click="view.toggleGrid()">
        グリッド
      </button>
      <button
        type="button"
        data-toggle="axes"
        title="原点から x（赤）・y（緑）・z（青）の向きを出す"
        :aria-pressed="view.showAxes"
        @click="view.setAxes(!view.showAxes)"
      >
        座標軸
      </button>
      <button
        type="button"
        data-toggle="labels"
        title="2D表示のマスにブロックの略称を出す"
        :aria-pressed="view.showLabels"
        @click="view.setLabels(!view.showLabels)"
      >
        略称
      </button>
    </div>
    <!-- 選択の解除（#12） -->
    <div class="bar-group" role="group" aria-label="強調">
      <button
        type="button"
        data-action="clear-highlight"
        title="ブロック一覧で選んだブロックの強調をやめ、すべてを普通に表示する"
        :disabled="search.highlightId === null"
        @click="search.clearHighlight()"
      >
        強調を解除
      </button>
    </div>
    <EditControls />
    <!-- パネルの表示、全画面 -->
  </div>
</template>

<style scoped>
.layer-box {
  min-width: 56px;
  text-align: center;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

button[aria-pressed='true'] {
  background: color-mix(in srgb, Highlight 22%, Canvas);
  border-color: Highlight;
}
</style>
