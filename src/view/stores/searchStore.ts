import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { parseBlockQuery, type BlockQuery } from '../../analysis/blockSearch'

/**
 * ブロック一覧の絞り込みと、強調しているブロック（#15）。
 * 強調の位置は設計図から作るので、ここには ID だけを持つ（view/analysis/useSearchHighlight.ts）。
 */
export const useSearchStore = defineStore('search', () => {
  /** 絞り込みの入力欄の文字 */
  const text = ref('')
  const query = computed<BlockQuery>(() => parseBlockQuery(text.value))
  /** 強調しているブロックの ID（"create:shaft"）。強調していなければ null */
  const highlightId = ref<string | null>(null)

  function setText(value: string): void {
    text.value = value
  }

  /** id を強調する。もう強調している ID なら解除する */
  function toggleHighlight(id: string): void {
    highlightId.value = highlightId.value === id ? null : id
  }

  function setHighlight(id: string | null): void {
    highlightId.value = id
  }

  function clearHighlight(): void {
    highlightId.value = null
  }

  return { text, query, highlightId, setText, toggleHighlight, setHighlight, clearHighlight }
})
