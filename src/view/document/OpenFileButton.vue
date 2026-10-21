<script setup lang="ts">
// 「ファイルを開く」ボタン。選んだ設計図を DocumentSession で開く。
// ブラウザ版は <input type="file">、デスクトップ版（Tauri）はファイルを選ぶダイアログを使う
import { ref } from 'vue'
import { blueprintFileExtensions } from '../../io/readers/readBlueprint'
import { pickDesktopBlueprintFile } from '../platform/fileAccess'
import { isDesktop } from '../platform/platform'
import { useDocumentSession } from './documentSession'

const session = useDocumentSession()
const opening = session.opening
const input = ref<HTMLInputElement | null>(null)
const accept = blueprintFileExtensions.join(',')
const desktop = isDesktop()
/** デスクトップ版で、ファイルを選ぶ画面を出せなかったときのお知らせ */
const pickError = ref<string | null>(null)

async function onClick(): Promise<void> {
  if (!desktop) {
    input.value?.click()
    return
  }
  pickError.value = null
  try {
    const file = await pickDesktopBlueprintFile(blueprintFileExtensions)
    if (file) await session.openFile(file)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    pickError.value = `ファイルを選ぶ画面を開けませんでした（${detail}）。もう一度「ファイルを開く…」を押してください。`
  }
}

function onPicked(event: Event): void {
  const el = event.target as HTMLInputElement
  const file = el.files?.[0]
  // 同じファイルをもう一度選んでも change が起きるように空にする
  el.value = ''
  if (file) void session.openFile(file)
}
</script>

<template>
  <button
    type="button"
    class="open-file"
    :disabled="opening"
    :title="`設計図（${accept}）を開きます。表示部分にファイルを落としても開けます`"
    @click="onClick"
  >
    {{ opening ? '開いています…' : 'ファイルを開く…' }}
  </button>
  <span v-if="pickError" class="pick-error" role="alert">{{ pickError }}</span>
  <input ref="input" class="hidden" type="file" :accept="accept" data-testid="open-file-input" @change="onPicked" />
</template>

<style scoped>
.hidden {
  display: none;
}

.pick-error {
  color: #c0392b;
  font-size: 12px;
}
</style>
