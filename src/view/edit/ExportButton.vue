<script setup lang="ts">
// 「書き出し（.nbt）」ボタン（#21）。
// 生データのないブロックや足りない Mod があれば、先に知らせて確かめてから書き出す。
// 保存先を選ぶ画面は利用者の操作の中でしか開けないので、書き出しはクリックの処理から直接始める。
// 保存先はブラウザ版とデスクトップ版で違う（view/platform/fileAccess.ts の createBlueprintSink）。
import { computed, ref } from 'vue'
import type { FileSink } from '../../io/fileSink'
import { exportBlueprint } from '../../io/writers/exportBlueprint'
import { exportSummary } from '../../io/writers/exportSummary'
import { useMissingMods } from '../analysis/useMissingMods'
import { useDocumentSession } from '../document/documentSession'
import { createBlueprintSink } from '../platform/fileAccess'
import ModalDialog from '../shell/ModalDialog.vue'
import { exportErrorMessage, exportNotices, exportResultMessage } from './exportMessages'

const props = withDefaults(defineProps<{ createSink?: () => FileSink }>(), {
  createSink: createBlueprintSink,
})

const session = useDocumentSession()
const missingMods = useMissingMods()

const exporting = ref(false)
const confirming = ref(false)
/** 書き出し前のお知らせ（確かめる画面を開いたときのもの） */
const notices = ref<string[]>([])
const message = ref<{ text: string; error: boolean } | null>(null)

const disabled = computed(() => !session.current.value || exporting.value)

function onClick(): void {
  const doc = session.current.value
  if (!doc) return
  message.value = null
  const found = exportNotices(exportSummary(doc.blueprint), missingMods.exportNotice.value)
  if (found.length === 0) {
    void run()
    return
  }
  notices.value = found
  confirming.value = true
}

/** 確かめる画面の「書き出す」。このクリックの中で保存先を選ぶ画面を開く */
function onConfirm(): void {
  confirming.value = false
  void run()
}

async function run(): Promise<void> {
  const doc = session.current.value
  if (!doc) return
  exporting.value = true
  try {
    const result = await exportBlueprint(doc.blueprint, props.createSink())
    message.value = { text: exportResultMessage(result), error: false }
  } catch (e) {
    message.value = { text: exportErrorMessage(e), error: true }
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <button
    type="button"
    data-action="export"
    :disabled="disabled"
    :title="session.current.value ? '設計図を .nbt で書き出します' : '設計図を開くと書き出せます'"
    @click="onClick"
  >
    {{ exporting ? '書き出しています…' : '書き出し（.nbt）' }}
  </button>
  <span
    v-if="message"
    class="message"
    :class="{ error: message.error }"
    :role="message.error ? 'alert' : 'status'"
    data-testid="export-message"
  >
    {{ message.text }}
    <button type="button" class="dismiss" title="お知らせを消す" @click="message = null">×</button>
  </span>
  <ModalDialog v-if="confirming" title="書き出しの前に" @close="confirming = false">
    <ul class="notices">
      <li v-for="n in notices" :key="n">{{ n }}</li>
    </ul>
    <p class="question">このまま書き出しますか。</p>
    <template #actions>
      <button type="button" @click="confirming = false">やめる</button>
      <button type="button" data-action="confirm-export" @click="onConfirm">書き出す</button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.message {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 40em;
}

.message.error {
  color: #c0392b;
}

.dismiss {
  padding: 0 4px;
  border: none;
  background: none;
  color: inherit;
  cursor: pointer;
}

.notices {
  margin: 0;
  padding-left: 1.2em;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.question {
  margin: 0;
}
</style>
