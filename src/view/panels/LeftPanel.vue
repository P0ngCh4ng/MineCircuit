<script setup lang="ts">
// 左パネル。docs/ui.md「全体の配置」：置くブロック、ブロック一覧、使っているMod。
// 各 Issue の部品を、下の並び順でここに1行ずつ足す。
import UsedMods from '../analysis/UsedMods.vue'
</script>

<template>
  <aside class="panel left-panel" aria-label="ブロック">
    <!-- 置くブロック（#18, #19） -->
    <!-- ブロック一覧：全体／この段、検索、強調（#11, #15） -->
    <!-- 使っているMod・足りないMod（#26） -->
    <UsedMods />
  </aside>
</template>
