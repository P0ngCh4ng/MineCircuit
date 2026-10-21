<script setup lang="ts">
// 表示部分の左上の縦のツールバー。docs/ui.md「ツール」
import { useToolStore } from '../stores/toolStore'
import type { ToolId } from './tool'
import { TOOL_CATALOG, type ToolInfo } from './toolCatalog'

const store = useToolStore()

// アイコンの線（viewBox 0 0 20 20）
const ICONS: Record<ToolId, string[]> = {
  select: ['M5 3l10 6.5-4.6 1.1L8.6 15z'],
  measure: ['M3 14L14 3l3 3L6 17z', 'M7 10l1.5 1.5M9.5 7.5L11 9M12 5l1.5 1.5'],
  connect: ['M2.5 7.5h5v5h-5zM12.5 7.5h5v5h-5zM7.5 2.5h5v5h-5z', 'M7.5 10h5'],
  probe: ['M12 3l5 5-7 7-3 1 1-3z', 'M4 16l-1.5 1.5'],
  port: ['M9 4.5h8v11H9z', 'M2 10h5M5 7.5L7.5 10 5 12.5'],
  place: ['M10 2.5l6.5 3.5v8L10 17.5 3.5 14V6z', 'M10 7v6M7 10h6'],
  erase: ['M10 2.5l6.5 3.5v8L10 17.5 3.5 14V6z', 'M7.5 7.5l5 5M12.5 7.5l-5 5'],
  pick: ['M13.5 3.5l3 3-2 2-3-3z', 'M11.5 5.5l-7 7-1 4 4-1 7-7'],
}

function title(tool: ToolInfo): string {
  const name = tool.key ? `${tool.label}（${tool.key}）` : tool.label
  const note = store.isAvailable(tool.id) ? '' : '（まだ使えません）'
  return `${name}：${tool.description}${note}`
}
</script>

<template>
  <div class="tool-bar" role="toolbar" aria-label="ツール" aria-orientation="vertical">
    <template v-for="tool in TOOL_CATALOG" :key="tool.id">
      <hr v-if="tool.groupStart" class="separator" />
      <button
        type="button"
        :data-tool="tool.id"
        :aria-label="tool.label"
        :aria-pressed="store.activeToolId === tool.id"
        :disabled="!store.isAvailable(tool.id)"
        :title="title(tool)"
        @click="store.setTool(tool.id)"
      >
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path v-for="d in ICONS[tool.id]" :key="d" :d="d" />
        </svg>
        <kbd v-if="tool.key">{{ tool.key }}</kbd>
      </button>
    </template>
  </div>
</template>

<style scoped>
.tool-bar {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  border-radius: 6px;
  background: color-mix(in srgb, Canvas 85%, transparent);
  box-shadow: 0 1px 3px rgb(0 0 0 / 25%);
}

button {
  position: relative;
  width: 34px;
  height: 34px;
  padding: 7px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: inherit;
  cursor: pointer;
}

button:hover:not(:disabled) {
  background: color-mix(in srgb, CanvasText 10%, transparent);
}

button[aria-pressed='true'] {
  border-color: Highlight;
  background: color-mix(in srgb, Highlight 20%, transparent);
}

button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

svg {
  display: block;
  width: 100%;
  height: 100%;
}

kbd {
  position: absolute;
  right: 1px;
  bottom: 0;
  font-size: 9px;
  font-family: inherit;
  opacity: 0.7;
}

.separator {
  width: 100%;
  margin: 2px 0;
  border: none;
  border-top: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
}
</style>
