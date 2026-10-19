// 計算を走らせる時機を決める。変更が続く間は待ち、止まってから1回だけ走らせる。
// 計算そのものは CalcBackend に任せる（画面では Web Worker、テストではこのスレッド）。

import type { Blueprint } from '../domain/blueprint'
import { Signal } from '../edit/signal'
import type { CalcModpack } from './calcPlugin'
import { runPlugins, type PluginOutcome, type PluginRegistry } from './pluginRegistry'
import type { VirtualPort } from './virtualPort'

/** 計算1回分の入力 */
export interface CalcRequest {
  readonly blueprint: Blueprint
  readonly pack: CalcModpack | null
  readonly ports: readonly VirtualPort[]
}

/** 計算を実際に行うところ */
export interface CalcBackend {
  run(request: CalcRequest): Promise<PluginOutcome[]>
  /** 後片付け（Worker を止めるなど） */
  dispose?(): void
}

/** このスレッドで計算する。テストと、Worker が使えないときに使う */
export class InlineCalcBackend implements CalcBackend {
  constructor(private readonly registry: PluginRegistry) {}

  run(request: CalcRequest): Promise<PluginOutcome[]> {
    return runPlugins(this.registry, request.blueprint, request.pack, request.ports)
  }
}

/** idle: 何もしていない / waiting: 変更が止まるのを待っている / running: 計算中 */
export type CalcStatus = 'idle' | 'waiting' | 'running'

/** 変更が止まったとみなすまでの時間（ミリ秒） */
export const DEFAULT_CALC_DELAY_MS = 400

export interface CalcSchedulerOptions {
  delayMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export class CalcScheduler {
  readonly onStatus = new Signal<CalcStatus>()
  /** 最新の入力に対する結果だけを渡す。古い入力の結果は捨てる */
  readonly onResult = new Signal<PluginOutcome[]>()
  /** 計算の仕組みそのものの失敗（Worker が落ちたなど）。プラグインの失敗は結果の 'error' に入る */
  readonly onError = new Signal<string>()

  private readonly delayMs: number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void
  private timer: unknown = null
  private source: (() => CalcRequest | null) | null = null
  private running = false
  /** 変更のたびに増やす。計算を始めたときと終わったときで違えば、その結果は古い */
  private generation = 0
  private disposed = false
  private currentStatus: CalcStatus = 'idle'

  constructor(
    private readonly backend: CalcBackend,
    options: CalcSchedulerOptions = {},
  ) {
    this.delayMs = options.delayMs ?? DEFAULT_CALC_DELAY_MS
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  }

  get status(): CalcStatus {
    return this.currentStatus
  }

  /**
   * 変更があったことを知らせる。delayMs の間に次の変更がなければ計算する。
   * source は計算を始めるときに呼ぶ（そのときの設計図で計算する）。null を返したら計算しない。
   */
  schedule(source: () => CalcRequest | null): void {
    if (this.disposed) return
    this.source = source
    this.generation++
    this.stopTimer()
    this.timer = this.setTimer(() => {
      this.timer = null
      void this.start()
    }, this.delayMs)
    if (!this.running) this.setStatus('waiting')
  }

  /** 待たずに計算する。計算中なら、終わったあとにもう一度計算する */
  runNow(source: () => CalcRequest | null): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.source = source
    this.generation++
    this.stopTimer()
    return this.start()
  }

  /** 待っている計算をやめる。計算中のものの結果は捨てる */
  cancel(): void {
    this.stopTimer()
    this.source = null
    this.generation++
    if (!this.running) this.setStatus('idle')
  }

  dispose(): void {
    this.cancel()
    this.disposed = true
    this.backend.dispose?.()
  }

  private stopTimer(): void {
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = null
  }

  private async start(): Promise<void> {
    // 計算中なら、終わったときに generation の違いを見て計算し直す
    if (this.disposed || this.running) return
    const request = this.source?.() ?? null
    if (request === null) {
      this.setStatus(this.timer !== null ? 'waiting' : 'idle')
      return
    }
    const generation = this.generation
    this.running = true
    this.setStatus('running')
    let outcomes: PluginOutcome[] | null = null
    let failure: string | null = null
    try {
      outcomes = await this.backend.run(request)
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      failure = `計算できませんでした（${detail}）。ページを読み込み直してください。`
    }
    this.running = false
    if (this.disposed) return
    if (generation !== this.generation) {
      // 計算中に変更があった。この結果は古いので捨てる。待ち時間が過ぎていればすぐ計算し直す
      if (this.timer === null && this.source !== null) return this.start()
      this.setStatus(this.timer !== null ? 'waiting' : 'idle')
      return
    }
    this.setStatus('idle')
    if (failure !== null) this.onError.emit(failure)
    else if (outcomes) this.onResult.emit(outcomes)
  }

  private setStatus(status: CalcStatus): void {
    if (status === this.currentStatus) return
    this.currentStatus = status
    this.onStatus.emit(status)
  }
}
