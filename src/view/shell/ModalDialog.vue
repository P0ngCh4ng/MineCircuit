<script setup lang="ts">
// 画面の上に重ねて出す小さな画面（新規の設計図、書き出しの確認など）。
// Esc か外側のクリックで閉じる。中身は既定のスロット、ボタンは actions のスロットに入れる。
import { nextTick, onMounted, ref } from 'vue'

defineProps<{ title: string }>()
const emit = defineEmits<{ close: [] }>()

const box = ref<HTMLElement | null>(null)

onMounted(async () => {
  await nextTick()
  // 最初の入力欄かボタンに移る。キーボードだけでも操作できるように
  const first = box.value?.querySelector<HTMLElement>('input, select, button:not([disabled])')
  first?.focus()
})

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  // 全体のキー操作（Esc で選択の解除）に届かないようにする
  e.preventDefault()
  emit('close')
}
</script>

<template>
  <div class="backdrop" @mousedown.self="emit('close')">
    <div ref="box" class="dialog" role="dialog" aria-modal="true" :aria-label="title" @keydown="onKeydown">
      <h2 class="title">{{ title }}</h2>
      <slot />
      <div class="actions">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgb(0 0 0 / 35%);
}

.dialog {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(440px, 100%);
  max-height: 100%;
  overflow: auto;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: Canvas;
  box-shadow: 0 4px 16px rgb(0 0 0 / 30%);
}

.title {
  margin: 0;
  font-size: 15px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
