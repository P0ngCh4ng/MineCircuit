<script setup lang="ts">
// 上のバー2段目の「編集」。元に戻す・やり直す・書き出し
import { computed } from 'vue'
import { useDocumentSession } from '../document/documentSession'
import ExportButton from './ExportButton.vue'

const session = useDocumentSession()
const { canUndo, canRedo, nextUndoLabel, nextRedoLabel } = session

const undoTitle = computed(() =>
  nextUndoLabel.value ? `元に戻す：${nextUndoLabel.value}（Ctrl+Z）` : '元に戻す操作はありません（Ctrl+Z）',
)
const redoTitle = computed(() =>
  nextRedoLabel.value ? `やり直す：${nextRedoLabel.value}（Ctrl+Y）` : 'やり直す操作はありません（Ctrl+Y）',
)
</script>

<template>
  <div class="bar-group" role="group" aria-label="編集">
    <span class="bar-label">編集</span>
    <button type="button" data-action="undo" :disabled="!canUndo" :title="undoTitle" @click="session.undo()">
      元に戻す
    </button>
    <button type="button" data-action="redo" :disabled="!canRedo" :title="redoTitle" @click="session.redo()">
      やり直す
    </button>
    <ExportButton />
  </div>
</template>
