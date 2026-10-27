<script setup lang="ts">
// 右パネル。docs/ui.md「全体の配置」：選択中のブロック、計算結果。
// 各 Issue の部品を、下の並び順でここに1行ずつ足す。
import { computed } from 'vue'
import { isSingleCell } from '../../domain/box'
import { useToolStore } from '../stores/toolStore'
import CalcPanel from '../CalcPanel.vue'
import ProbePanel from '../calc/ProbePanel.vue'
import PortPanel from '../calc/PortPanel.vue'
import BlockDetail from '../selection/BlockDetail.vue'
import SelectionPanel from '../selection/SelectionPanel.vue'

const tools = useToolStore()
// 2つ以上のブロックが入る範囲を選んでいるときは「選択範囲」、それ以外は「選択中のブロック」（#130）
const showRange = computed(() => tools.selectionBox !== null && !isSingleCell(tools.selectionBox))
</script>

<template>
  <aside class="panel right-panel" aria-label="右パネル">
    <!-- 選択範囲：座標と大きさ、中のブロックの数、消す・塗る・置き換え（#130） -->
    <SelectionPanel v-if="showRange" />
    <!-- 選択中のブロック：ID、位置、ブロック状態、生データのツリー（#12） -->
    <BlockDetail v-else />
    <!-- プローブ：マウスの下のブロックの回転数・応力（#31。プローブのツールを使っている間と、強調している間だけ出す） -->
    <ProbePanel />
    <!-- 仮の入出力：置く種類と一覧（#70。ツールを使っている間と、置いている間だけ出す） -->
    <PortPanel />
    <!-- 計算結果（#29。プローブと問題の一覧は #31） -->
    <CalcPanel />
  </aside>
</template>
