<script setup lang="ts">
// 右パネル。docs/ui.md「全体の配置」：選択中のブロック、計算結果。
// 各 Issue の部品を、下の並び順でここに1行ずつ足す。
import CalcPanel from '../CalcPanel.vue'
import BlockDetail from '../selection/BlockDetail.vue'
</script>

<template>
  <aside class="panel right-panel" aria-label="右パネル">
    <!-- 選択中のブロック：ID、位置、ブロック状態、生データのツリー（#12） -->
    <BlockDetail />
    <!-- 計算結果（#29。プローブと問題の一覧は #31） -->
    <CalcPanel />
  </aside>
</template>
