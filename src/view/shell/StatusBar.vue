<script setup lang="ts">
// 下の状態表示。マウス位置、選択中のブロック、注意書き
import { computed } from 'vue'
import type { Vec3 } from '../../domain/vec3'
import { useBrushStore } from '../stores/brushStore'
import { useToolStore } from '../stores/toolStore'

const tools = useToolStore()
const brush = useBrushStore()

function formatPos(pos: Vec3 | null): string {
  return pos ? `${pos.join(', ')}（段 ${pos[1] + 1}）` : '–'
}

const hover = computed(() => formatPos(tools.hoverTarget?.pos ?? null))
const selected = computed(() => formatPos(tools.selectedPos))
</script>

<template>
  <footer class="status-bar">
    <span>マウス位置 <b data-status="hover">{{ hover }}</b></span>
    <span>選択 <b data-status="selected">{{ selected }}</b></span>
    <span v-if="brush.message" data-status="message" role="status">{{ brush.message }}</span>
    <span class="spacer"></span>
    <span class="notice">
      ファイルはブラウザ内だけで読み込み、外部に送信しません。非公式ツールです。Mojang Studios・Microsoft および各 Mod の作者とは関係ありません。
    </span>
  </footer>
</template>

<style scoped>
.status-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 18px;
  padding: 4px 12px;
  border-top: 1px solid var(--line);
  background: var(--panel);
  font-size: 12px;
}

b {
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.spacer {
  flex: 1;
}

.notice {
  opacity: 0.75;
}
</style>
