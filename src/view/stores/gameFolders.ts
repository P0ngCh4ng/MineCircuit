// 選んだゲームのフォルダ（Minecraft 本体の jar と資産の索引があるランチャーのフォルダ）の状態。
// 開けたフォルダ（opened）が変わると、modpackContent が Modpack を読み直し、本体の jar を探し直す。
// フォルダそのものは画面の状態ではないので、リアクティブにしない（shallowRef + markRaw）。

import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef } from 'vue'
import type { FileSource } from '../../io/fileSource'
import type { GameFolderEntry, GameFolderRegistry } from '../../io/modpack/gameFolderRegistry'
import type { GameFolder } from '../../io/modpack/modpackLoader'

export type GameFolderStatus = 'opened' | 'needs-permission' | 'error'

export interface GameFolderView extends GameFolderEntry {
  readonly status: GameFolderStatus
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export const useGameFolderStore = defineStore('gameFolders', () => {
  // ハンドルの型はブラウザ版（フォルダのハンドル）とデスクトップ版（パス）で違うので、ここでは問わない
  let registry: GameFolderRegistry<unknown> | null = null
  const entries = ref<GameFolderEntry[]>([])
  const statuses = ref<Record<string, GameFolderStatus>>({})
  const sources = new Map<string, FileSource>()
  /** 開けたフォルダ（選んだ順）。本体の jar を探す場所 */
  const opened = shallowRef<readonly GameFolder[]>([])
  const message = ref<string | null>(null)

  const folders = computed<GameFolderView[]>(() =>
    entries.value.map((e) => ({ ...e, status: statuses.value[e.id] ?? 'needs-permission' })),
  )

  /** 開けたフォルダの一覧を作り直す。変わっていなければそのまま（Modpack を読み直さない） */
  function publish(): void {
    const next = entries.value.flatMap((e) => {
      const source = sources.get(e.id)
      return source ? [{ name: e.name, source }] : []
    })
    const prev = opened.value
    if (next.length === prev.length && next.every((f, i) => f.source === prev[i].source && f.name === prev[i].name)) return
    opened.value = markRaw(next)
  }

  async function openOne(id: string, requestPermission: boolean): Promise<void> {
    if (!registry) return
    try {
      const result = await registry.open(id, requestPermission)
      if (result.kind === 'opened') {
        sources.set(id, markRaw(result.source))
        statuses.value = { ...statuses.value, [id]: 'opened' }
      } else {
        sources.delete(id)
        statuses.value = { ...statuses.value, [id]: result.kind === 'needs-permission' ? 'needs-permission' : 'error' }
      }
    } catch (e) {
      sources.delete(id)
      statuses.value = { ...statuses.value, [id]: 'error' }
      message.value = `Minecraft 本体のフォルダを読めませんでした（${errorText(e)}）。フォルダがあるか確かめて、選び直してください。`
    }
  }

  /** 一覧を読み、許可のあるフォルダを開く（許可は求めない） */
  async function init<H>(r: GameFolderRegistry<H>): Promise<void> {
    registry = r
    entries.value = await r.list()
    for (const e of entries.value) await openOne(e.id, false)
    publish()
  }

  /** フォルダを足して開く。handle は init で渡した一覧のハンドルの型にする */
  async function add(name: string, source: FileSource, handle: unknown): Promise<void> {
    if (!registry) return
    message.value = null
    try {
      const result = await registry.add(name, source, handle)
      if (result.kind === 'invalid') {
        message.value =
          '選んだフォルダに versions・libraries・assets のフォルダも jar もありません。ランチャーのフォルダ（CurseForge なら minecraft の中の Install）を選んでください。'
        return
      }
      entries.value = await registry.list()
      sources.set(result.entry.id, markRaw(source))
      statuses.value = { ...statuses.value, [result.entry.id]: 'opened' }
      publish()
    } catch (e) {
      message.value = `Minecraft 本体のフォルダを登録できませんでした（${errorText(e)}）。`
    }
  }

  /** 前回の許可が切れたフォルダを、許可を求めて開き直す。ボタンの操作の中から呼ぶ */
  async function grantPermission(): Promise<void> {
    for (const f of folders.value) if (f.status === 'needs-permission') await openOne(f.id, true)
    publish()
  }

  /** 一覧から外す。フォルダの中身には触らない */
  async function remove(id: string): Promise<void> {
    if (!registry) return
    await registry.remove(id)
    sources.delete(id)
    entries.value = await registry.list()
    publish()
  }

  return { folders, opened, message, init, add, grantPermission, remove }
})
