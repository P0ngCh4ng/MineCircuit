// 問題の重さの、画面に出す名前（#159）。右パネルの問題の一覧と、下の状態表示で使う。

import type { IssueSeverity } from '../../calc/calcPlugin'

export const SEVERITY_LABELS: Readonly<Record<IssueSeverity, string>> = {
  error: 'エラー',
  warning: '警告',
  info: '情報',
}
