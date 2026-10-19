// 今の段（docs/design.md の ViewState の layer）。値は y（0 始まり）。画面では +1 して出す。
// ここでは値を持つだけ。段の移動（▲▼、PageUp / PageDown）と表示方法は #10 で足す。

import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useLayerStore = defineStore('layer', () => {
  /** 今の段の y。設計図の高さを超えることがあるので、使う側で clampLayer を通す */
  const current = ref(0)

  function setLayer(y: number): void {
    current.value = Math.max(0, Math.floor(y))
  }

  return { current, setLayer }
})

/** 段 y を、高さ height の設計図の範囲（0 〜 height-1）に収める */
export function clampLayer(y: number, height: number): number {
  return Math.min(Math.max(0, y), Math.max(0, height - 1))
}
