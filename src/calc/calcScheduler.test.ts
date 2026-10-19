import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { blueprintFixture } from '../../tests/fixtures/blueprintFixture'
import { CalcScheduler, type CalcBackend, type CalcRequest, type CalcStatus } from './calcScheduler'
import type { PluginOutcome } from './pluginRegistry'

const bp = blueprintFixture().place([0, 0, 0], 'minecraft:stone').toBlueprint()

/** run を呼ばれた回数を数え、resolve を外から呼べる計算の仕組み */
class ManualBackend implements CalcBackend {
  readonly calls: { request: CalcRequest; resolve: (o: PluginOutcome[]) => void; reject: (e: Error) => void }[] = []
  run(request: CalcRequest): Promise<PluginOutcome[]> {
    return new Promise((resolve, reject) => this.calls.push({ request, resolve, reject }))
  }
}

function outcome(label: string): PluginOutcome[] {
  return [{ pluginId: 'p', label, status: 'ok', result: { summary: [], issues: [], assumptions: [] } }]
}

const request = (): CalcRequest => ({ blueprint: bp, pack: null, ports: [] })

describe('CalcScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function setup() {
    const backend = new ManualBackend()
    const scheduler = new CalcScheduler(backend, { delayMs: 100 })
    const statuses: CalcStatus[] = []
    const results: string[] = []
    const errors: string[] = []
    scheduler.onStatus.connect((s) => statuses.push(s))
    scheduler.onResult.connect((o) => results.push(o[0].label))
    scheduler.onError.connect((m) => errors.push(m))
    return { backend, scheduler, statuses, results, errors }
  }

  it('変更が続く間は待ち、止まってから1回だけ計算する', async () => {
    const { backend, scheduler, statuses, results } = setup()
    scheduler.schedule(request)
    vi.advanceTimersByTime(50)
    scheduler.schedule(request)
    vi.advanceTimersByTime(50)
    scheduler.schedule(request)
    vi.advanceTimersByTime(99)
    expect(backend.calls).toHaveLength(0)
    expect(scheduler.status).toBe('waiting')
    vi.advanceTimersByTime(1)
    expect(backend.calls).toHaveLength(1)
    backend.calls[0].resolve(outcome('a'))
    await vi.runAllTimersAsync()
    expect(results).toEqual(['a'])
    expect(statuses).toEqual(['waiting', 'running', 'idle'])
  })

  it('計算中に変更があれば、その結果は捨てて計算し直す', async () => {
    const { backend, scheduler, results } = setup()
    void scheduler.runNow(request)
    expect(backend.calls).toHaveLength(1)
    scheduler.schedule(request)
    vi.advanceTimersByTime(100) // 待ち時間が過ぎても、計算中なので始めない
    expect(backend.calls).toHaveLength(1)
    backend.calls[0].resolve(outcome('old'))
    await vi.advanceTimersByTimeAsync(0)
    expect(backend.calls).toHaveLength(2)
    backend.calls[1].resolve(outcome('new'))
    await vi.advanceTimersByTimeAsync(0)
    expect(results).toEqual(['new'])
    expect(scheduler.status).toBe('idle')
  })

  it('計算中に変更があり、まだ待っている間に終わったら、待ち時間のあとに計算する', async () => {
    const { backend, scheduler, results } = setup()
    void scheduler.runNow(request)
    scheduler.schedule(request)
    backend.calls[0].resolve(outcome('old'))
    await vi.advanceTimersByTimeAsync(0)
    expect(scheduler.status).toBe('waiting')
    expect(backend.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(backend.calls).toHaveLength(2)
    backend.calls[1].resolve(outcome('new'))
    await vi.advanceTimersByTimeAsync(0)
    expect(results).toEqual(['new'])
  })

  it('source が null を返したら計算しない。cancel で待ちをやめる', async () => {
    const { backend, scheduler } = setup()
    scheduler.schedule(() => null)
    await vi.advanceTimersByTimeAsync(100)
    expect(backend.calls).toHaveLength(0)
    expect(scheduler.status).toBe('idle')
    scheduler.schedule(request)
    scheduler.cancel()
    await vi.advanceTimersByTimeAsync(200)
    expect(backend.calls).toHaveLength(0)
  })

  it('計算の仕組みが失敗したら onError で知らせる', async () => {
    const { backend, scheduler, errors, results } = setup()
    const done = scheduler.runNow(request)
    backend.calls[0].reject(new Error('Worker が止まりました'))
    await done
    expect(results).toEqual([])
    expect(errors[0]).toMatch(/Worker が止まりました/)
    expect(scheduler.status).toBe('idle')
  })
})
