/** 合図。connect で受け取る関数を登録し、emit で順に呼ぶ。Vue に依存しない */
export class Signal<T> {
  private readonly listeners = new Set<(value: T) => void>()

  /** fn を登録する。戻り値を呼ぶと登録を外す */
  connect(fn: (value: T) => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  emit(value: T): void {
    // 呼んでいる間に登録が変わっても、その時点の一覧で呼ぶ
    for (const fn of [...this.listeners]) fn(value)
  }
}
