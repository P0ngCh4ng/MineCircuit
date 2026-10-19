<script setup lang="ts">
// 「ファイルを開く」ボタン。選んだ設計図を DocumentSession で開く
import { ref } from 'vue'
import { blueprintFileExtensions } from '../../io/readers/readBlueprint'
import { useDocumentSession } from './documentSession'

const session = useDocumentSession()
const opening = session.opening
const input = ref<HTMLInputElement | null>(null)
const accept = blueprintFileExtensions.join(',')

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
    @click="input?.click()"
  >
    {{ opening ? '開いています…' : 'ファイルを開く…' }}
  </button>
  <input ref="input" class="hidden" type="file" :accept="accept" data-testid="open-file-input" @change="onPicked" />
</template>

<style scoped>
.hidden {
  display: none;
}
</style>
