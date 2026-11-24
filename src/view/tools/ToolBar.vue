<script setup lang="ts">
// 表示部分の左上の縦のツールバー。docs/ui.md「ツール」
import { useToolStore } from '../stores/toolStore'
import { TOOL_CATALOG, type ToolInfo } from './toolCatalog'

const store = useToolStore()

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
          <path v-for="d in tool.icon" :key="d" :d="d" />
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
