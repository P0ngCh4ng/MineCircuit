// Modpack の選択の状態。持つのは登録の一覧と、どれを選んでいるかだけ。
// Modpack の中身（Mod の一覧や表示名）は後の Issue の ModpackLoader が読む。

import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef } from 'vue'
import type { FileSource } from '../../io/fileSource'
import { describeFolderProblem } from '../../io/modpack/modpackFolder'
import type { ModpackEntry, ModpackRegistry } from '../../io/modpack/modpackRegistry'

/** 選んだ Modpack の状態 */
export type ModpackStatus = 'none' | 'opening' | 'ready' | 'needs-permission'

const SELECTED_KEY = 'minecircuit.modpack.selected'

function loadSelectedId(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY)
  } catch {
    return null
  }
}

function saveSelectedId(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(SELECTED_KEY)
    else localStorage.setItem(SELECTED_KEY, id)
  } catch {
    // 保存できなくても、次回選び直すだけで済む
  }
}

function errorMessage(e: unknown): string {
  const detail = e instanceof Error ? e.message : String(e)
  return `フォルダを読めませんでした（${detail}）。フォルダがあるか確かめて、もう一度選んでください。`
}

export const useModpackStore = defineStore('modpack', () => {
  // registry と開いたフォルダは画面の状態ではないので、リアクティブにしない
  let registry: ModpackRegistry<FileSystemDirectoryHandle> | null = null
  const source = shallowRef<FileSource | null>(null)

  const entries = ref<ModpackEntry[]>([])
  const selectedId = ref<string | null>(null)
  const status = ref<ModpackStatus>('none')
  /** 利用者に知らせること（登録の結果、エラー） */
  const message = ref<string | null>(null)

  const selected = computed(() => entries.value.find((e) => e.id === selectedId.value) ?? null)

  async function refresh(): Promise<void> {
    if (registry) entries.value = await registry.list()
  }

  async function open(id: string, requestPermission: boolean): Promise<void> {
    if (!registry) return
    status.value = 'opening'
    source.value = null
    try {
      const result = await registry.open(id, requestPermission)
      if (selectedId.value !== id) return // 開いている間に別のものが選ばれた
      switch (result.kind) {
        case 'opened':
          source.value = markRaw(result.source)
          status.value = 'ready'
          break
        case 'needs-permission':
          status.value = 'needs-permission'
          break
        case 'not-registered':
          selectedId.value = null
          saveSelectedId(null)
          status.value = 'none'
          break
      }
    } catch (e) {
      status.value = 'none'
      message.value = errorMessage(e)
    }
  }

  /** 登録の一覧を読み、前回選んだ Modpack を開く（許可は求めない） */
  async function init(r: ModpackRegistry<FileSystemDirectoryHandle>): Promise<void> {
    registry = r
    await refresh()
    const last = loadSelectedId()
    if (last !== null && entries.value.some((e) => e.id === last)) {
      selectedId.value = last
      await open(last, false)
    }
  }

  /** フォルダを登録して選ぶ */
  async function register(name: string, folder: FileSource, handle: FileSystemDirectoryHandle | null): Promise<void> {
    if (!registry) return
    message.value = null
    try {
      const result = await registry.register(name, folder, handle)
      if (result.kind === 'invalid') {
        message.value = describeFolderProblem(result.check)
        return
      }
      await refresh()
      selectedId.value = result.entry.id
      saveSelectedId(result.entry.id)
      source.value = markRaw(result.source)
      status.value = 'ready'
      message.value = `「${name}」を登録しました（Mod の jar ${result.jarCount} 個）。`
    } catch (e) {
      message.value = errorMessage(e)
    }
  }

  /** 一覧から選ぶ。null なら選ばない。ボタンなどの操作の中から呼ぶので、許可を求めてよい */
  async function select(id: string | null): Promise<void> {
    message.value = null
    selectedId.value = id
    saveSelectedId(id)
    if (id === null) {
      source.value = null
      status.value = 'none'
      return
    }
    await open(id, true)
  }

  /** 前回の許可が切れているとき、読む許可を求め直す */
  async function grantPermission(): Promise<void> {
    if (selectedId.value !== null) await open(selectedId.value, true)
  }

  /** 登録を外す。フォルダの中身には触らない */
  async function remove(id: string): Promise<void> {
    if (!registry) return
    await registry.remove(id)
    if (selectedId.value === id) await select(null)
    await refresh()
  }

  return {
    entries,
    selectedId,
    selected,
    status,
    message,
    /** 選んでいる Modpack のフォルダ。開けていなければ null */
    source,
    init,
    register,
    select,
    grantPermission,
    remove,
  }
})
