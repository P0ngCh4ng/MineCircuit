<script setup lang="ts">
// 画面全体の配置。docs/ui.md「全体の配置」。
// 各場所の中身はそれぞれの部品のファイルで作る（App.vue は並べるだけ）。
import { watch } from 'vue'
import { useProbeTool } from './calc/useProbeTool'
import { usePortTool } from './calc/usePortTool'
import { useDocumentSession } from './document/documentSession'
import { usePasteModeSync, useClipboardActions } from './edit/clipboardActions'
import { useRelocationSync } from './edit/relocationSync'
import { useRotateAction } from './edit/rotateAction'
import { useEditTools } from './edit/useEditTools'
import LayerPanel from './layers/LayerPanel.vue'
import LeftPanel from './panels/LeftPanel.vue'
import RightPanel from './panels/RightPanel.vue'
import StatusBar from './shell/StatusBar.vue'
import TopBar from './shell/TopBar.vue'
import { useAppearanceSync } from './stores/appearanceSync'
import { useCalcStore } from './stores/calcStore'
import { useToolStore } from './stores/toolStore'
import { useViewStore } from './stores/viewStore'
import { useKeyboardShortcuts } from './tools/useKeyboardShortcuts'
import ViewportArea from './viewport/ViewportArea.vue'

const tools = useToolStore()
const calc = useCalcStore()
const view = useViewStore()
const session = useDocumentSession()
const rotate = useRotateAction()
const edit = useEditTools()
const clipboard = useClipboardActions()
// 貼り付けの見本は、ツールを切り替えたらやめる（#133）
usePasteModeSync(clipboard)
useProbeTool()
usePortTool()
// 範囲を動かしたら、選択範囲と仮の入出力も一緒に動かす
useRelocationSync()
// Modpack と設計図に合わせて、ブロックの見た目（テクスチャ）を用意する
useAppearanceSync()

// 設計図が入れ替わったら、前の設計図の選択を消し、計算の対象を変える
watch(session.current, (doc) => {
  tools.setSelected(null)
  tools.setHovered(null)
  void calc.attach(doc?.blueprint ?? null, doc?.history.onChange ?? null)
})

useKeyboardShortcuts({
  tool: (a) => tools.setTool(a.id),
  // 貼り付けの途中なら、貼り付けをやめる
  clearSelection: () => clipboard.cancel() || tools.setSelected(null),
  undo: () => session.undo(),
  redo: () => session.redo(),
  // 貼り付けの見本を出していれば、見本を回す
  rotateBrush: (a) => clipboard.rotatePreview(a.vertical ? 3 : 1) || rotate(a.vertical, a.overwrite),
  deleteSelection: () => edit.deleteSelected(),
  fillSelection: () => edit.fillSelection(),
  selectAll: () => edit.selectAll(),
  moveSelection: (a) => edit.moveSelection(a.direction, a.overwrite),
  toggleGrid: () => view.toggleGrid(),
  copySelection: () => clipboard.copy(),
  cutSelection: () => clipboard.cut(),
  paste: () => clipboard.paste(),
  duplicateSelection: () => clipboard.duplicate(),
})
</script>

<template>
  <div class="app">
    <TopBar class="area-top" />
    <LeftPanel class="area-left" />
    <ViewportArea class="area-view" />
    <LayerPanel class="area-layers" />
    <RightPanel class="area-right" />
    <StatusBar class="area-status" />
  </div>
</template>

<style scoped>
.app {
  display: grid;
  height: 100%;
  grid-template-columns: 260px minmax(0, 1fr) 104px 300px;
  grid-template-rows: auto minmax(0, 1fr) auto;
  grid-template-areas:
    'top top top top'
    'left view layers right'
    'status status status status';
}

.area-top {
  grid-area: top;
}

.area-left {
  grid-area: left;
  border-right: 1px solid var(--line);
}

.area-view {
  grid-area: view;
}

.area-layers {
  grid-area: layers;
  border-left: 1px solid var(--line);
}

.area-right {
  grid-area: right;
  border-left: 1px solid var(--line);
}

.area-status {
  grid-area: status;
}

/* 狭い画面は1列。上のバー、表示部分、段の一覧、左パネル、右パネルの順 */
@media (max-width: 900px) {
  .app {
    height: auto;
    min-height: 100%;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto 60vh auto auto auto auto;
    grid-template-areas: 'top' 'view' 'layers' 'left' 'right' 'status';
  }

  .area-left,
  .area-layers,
  .area-right {
    border: 0;
    border-top: 1px solid var(--line);
  }
}
</style>
