<script setup lang="ts">
// 上のバー2段目。docs/ui.md「全体の配置」の並び順で、各 Issue の部品をここに1行ずつ足す。
// 部品は .bar-group / .bar-label（style.css）で囲むと見た目がそろう。
import EditControls from '../edit/EditControls.vue'
</script>

<template>
  <div role="toolbar" aria-label="表示の操作">
    <!-- 3D/2D の切り替え（#9, #14） -->
    <!-- 視点：斜め・上・正面・横、全体を表示（#9） -->
    <!-- 段の移動と表示方法（#10） -->
    <!-- 補助表示：グリッド・座標軸・略称（#9, #14） -->
    <!-- 選択の解除（#12）と強調の解除（#15） -->
    <EditControls />
    <!-- パネルの表示、全画面 -->
  </div>
</template>
