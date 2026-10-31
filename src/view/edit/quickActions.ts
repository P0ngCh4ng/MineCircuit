// クイックバーの操作を動かす口（#197）。操作の中身（回す・元に戻すなど）は App.vue がキー操作と同じ処理で渡す。

import type { InjectionKey } from 'vue'
import type { QuickActionId } from './quickBarModel'

export interface QuickActionRunner {
  /** 操作を行う */
  run(id: QuickActionId): void
  /** 今押せるか（元に戻す操作がないときなど） */
  enabled(id: QuickActionId): boolean
}

export const QUICK_ACTION_RUNNER: InjectionKey<QuickActionRunner> = Symbol('quickActionRunner')
