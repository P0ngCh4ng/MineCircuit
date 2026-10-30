<script setup lang="ts">
// 右パネル。docs/ui.md「右パネル」：上「プロパティ」、下「計算」（#157）。
// 上下それぞれの中でスクロールし、ブロックを選んでも計算結果がスクロールの外に出ないようにする。
// 各 Issue の部品を、下の並び順でここに1行ずつ足す。
import { computed } from 'vue'
import { isSingleCell } from '../../domain/box'
import { useToolStore } from '../stores/toolStore'
import CalcPanel from '../CalcPanel.vue'
import ProbePanel from '../calc/ProbePanel.vue'
import BlockDetail from '../selection/BlockDetail.vue'
import SelectionPanel from '../selection/SelectionPanel.vue'

const tools = useToolStore()
// 2つ以上のブロックが入る範囲を選んでいるときは「選択範囲」、それ以外は「選択中のブロック」（#130）
const showRange = computed(() => tools.selectionBox !== null && !isSingleCell(tools.selectionBox))
</script>

<template>
  <aside class="panel right-panel" aria-label="右パネル">
    <div class="properties" aria-label="プロパティ" data-testid="right-properties">
      <!-- 選択範囲：座標と大きさ（#130）。範囲の操作は表示部分に浮かぶツールバー（#160） -->
      <SelectionPanel v-if="showRange" />
      <!-- 選択中のブロック：ID、位置、ブロック状態、生データのツリー（#12） -->
      <BlockDetail v-else />
      <!-- プローブ：マウスの下のブロックの回転数・応力（#31。プローブのツールを使っている間と、強調している間だけ出す） -->
      <ProbePanel />
    </div>
    <!-- 計算：まとめ・ネットワーク・問題・入出力（#70 の仮の入出力）・仮定のタブ（#29・#31・#157） -->
    <CalcPanel class="calc" data-testid="right-calc" />
  </aside>
</template>

<style scoped>
.right-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 上は中身の高さで、高くても 60% まで。残りを下の計算が使う（下は 40% より小さくしない） */
.properties {
  flex: 0 1 auto;
  max-height: 60%;
  min-height: 0;
  overflow: auto;
}

.calc {
  flex: 1 1 0;
  min-height: 40%;
  border-top: 1px solid var(--line);
}

/* 狭い画面（1列）では、ページ全体のスクロールに任せる */
@media (max-width: 900px) {
  .right-panel,
  .properties {
    overflow: visible;
  }
}
</style>
