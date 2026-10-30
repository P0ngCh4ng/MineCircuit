// 開いている設計図と、その編集の履歴を持つ。
// 設計図のデータは Pinia に入れず（CLAUDE.md「状態」）、リアクティブにもしない（markRaw）。
// 画面は version を読んで、設計図が入れ替わったときと編集のたびに描き直す。

import {
  computed,
  hasInjectionContext,
  inject,
  markRaw,
  provide,
  ref,
  shallowRef,
  type ComputedRef,
  type InjectionKey,
  type Ref,
  type ShallowRef,
} from 'vue'
import type { Blueprint } from '../../domain/blueprint'
import type { EditCommand, Relocation } from '../../edit/editCommand'
import { EditHistory } from '../../edit/editHistory'
import { Signal } from '../../edit/signal'
import { BlueprintReadError } from '../../io/readers/blueprintReader'
import { readBlueprint } from '../../io/readers/readBlueprint'

/** 開いている設計図1つ分。設計図ごとに編集の履歴を1つ持つ */
export interface BlueprintDocument {
  readonly blueprint: Blueprint
  readonly history: EditHistory
  /** 開いたファイルの名前。新規の設計図では Blueprint.name と同じ */
  readonly fileName: string
}

/** 範囲を動かした操作を書いた・元に戻した合図。forward が false なら元に戻した */
export interface RelocationEvent {
  readonly relocation: Relocation
  readonly forward: boolean
}

/** 編集の操作を書いた・元に戻した・やり直した合図。forward が false なら元に戻した */
export interface CommandEvent {
  readonly command: EditCommand
  readonly forward: boolean
}

/** 開くファイル。ブラウザの File と同じ形（テストでは偽物を渡せる） */
export interface FileLike {
  readonly name: string
  arrayBuffer(): Promise<ArrayBuffer>
}

/**
 * 開いている設計図の状態。画面の部品は useDocumentSession() で受け取る。
 *
 * - 設計図を読むとき：`current.value?.blueprint`。中身に依存する computed は先に `version.value` を読む
 * - 設計図を変えるとき：`apply(placeBlock(...))` のように、編集の操作を通す（設計のルール 6）
 */
export interface DocumentSession {
  /** 開いている設計図。開いていなければ null。中身はリアクティブでない */
  readonly current: Readonly<ShallowRef<BlueprintDocument | null>>
  /** 開く・閉じる・編集・元に戻す・やり直すのたびに 1 増える */
  readonly version: Readonly<Ref<number>>
  /** ファイルを読んでいる間 true */
  readonly opening: Readonly<Ref<boolean>>
  /** 開けなかったときのお知らせ（そのまま画面に出せる日本語）。なければ null */
  readonly error: Readonly<Ref<string | null>>

  readonly canUndo: ComputedRef<boolean>
  readonly canRedo: ComputedRef<boolean>
  /** 次に元に戻す操作の名前（「shaft を置く」）。なければ null */
  readonly nextUndoLabel: ComputedRef<string | null>
  /** 次にやり直す操作の名前。なければ null */
  readonly nextRedoLabel: ComputedRef<string | null>
  /** 画面の「書き出してから n 回の変更」。開いていなければ 0 */
  readonly unsavedChanges: ComputedRef<number>

  /** ファイルを読んで開く。開けたら true。開けなければ error に理由を入れ、今の設計図はそのまま */
  openFile(file: FileLike): Promise<boolean>
  /** バイト列から開く。openFile と同じ */
  openBytes(fileName: string, data: ArrayBuffer | Uint8Array): Promise<boolean>
  /** 作った設計図を開く（新規の設計図 #20 など）。履歴は空から始まる */
  setBlueprint(blueprint: Blueprint, fileName?: string): BlueprintDocument
  /** 設計図を閉じる */
  close(): void
  /**
   * 書き出した印を付ける。at は書き出しを始めたときの doc.history.changeCount。
   * 書き出しの途中で別の設計図に入れ替わっていても、書き出した doc に付ける
   */
  markExported(doc: BlueprintDocument, at: number): void

  /** 編集の操作を設計図に書き込み、履歴に積む。cmd が null（変化なし）なら何もせず false */
  apply(cmd: EditCommand | null): boolean
  /** 元に戻す。戻せる操作がなければ null */
  undo(): EditCommand | null
  /** やり直す。やり直せる操作がなければ null */
  redo(): EditCommand | null
  /** お知らせを消す */
  clearError(): void
  /** 範囲を動かした操作の apply・undo・redo のあとに呼ぶ。選択範囲と仮の入出力を一緒に動かすのに使う */
  readonly onRelocate: Signal<RelocationEvent>
  /** すべての操作の apply・undo・redo のあと（onRelocate のあと）に呼ぶ。消したブロックの仮の入出力を消すのに使う（#167） */
  readonly onCommand: Signal<CommandEvent>
}

function openErrorMessage(fileName: string, e: unknown): string {
  if (e instanceof BlueprintReadError) return e.message
  const detail = e instanceof Error ? e.message : String(e)
  return `"${fileName}" を開けませんでした（${detail}）。ファイルが壊れていないか確かめて、もう一度開いてください。`
}

/** 新しい DocumentSession を作る。アプリでは1つだけ使う（useDocumentSession） */
export function createDocumentSession(): DocumentSession {
  const current = shallowRef<BlueprintDocument | null>(null)
  const version = ref(0)
  const opening = ref(false)
  const error = ref<string | null>(null)
  let disconnect: (() => void) | null = null
  const onRelocate = new Signal<RelocationEvent>()
  const onCommand = new Signal<CommandEvent>()

  function relocated(cmd: EditCommand | null, forward: boolean): EditCommand | null {
    if (cmd?.relocation) onRelocate.emit({ relocation: cmd.relocation, forward })
    if (cmd) onCommand.emit({ command: cmd, forward })
    return cmd
  }
  // 読んでいる途中で次のファイルを開いたら、前の結果は捨てる
  let openToken = 0

  function bump(): void {
    version.value++
  }

  function replace(doc: BlueprintDocument | null): void {
    disconnect?.()
    disconnect = doc ? doc.history.onChange.connect(bump) : null
    current.value = doc ? markRaw(doc) : null
    bump()
  }

  function setBlueprint(blueprint: Blueprint, fileName: string = blueprint.name): BlueprintDocument {
    const doc: BlueprintDocument = {
      blueprint: markRaw(blueprint),
      history: markRaw(new EditHistory(blueprint)),
      fileName,
    }
    error.value = null
    replace(doc)
    return doc
  }

  async function load(fileName: string, read: () => Promise<ArrayBuffer | Uint8Array>): Promise<boolean> {
    const token = ++openToken
    opening.value = true
    error.value = null
    try {
      const blueprint = await readBlueprint(fileName, await read())
      if (token !== openToken) return false
      setBlueprint(blueprint, fileName)
      return true
    } catch (e) {
      if (token !== openToken) return false
      error.value = openErrorMessage(fileName, e)
      return false
    } finally {
      if (token === openToken) opening.value = false
    }
  }

  // 履歴は markRaw なので、version を読んで変化を拾う
  function historyValue<T>(fn: (history: EditHistory) => T, empty: T): ComputedRef<T> {
    return computed(() => {
      void version.value
      const doc = current.value
      return doc ? fn(doc.history) : empty
    })
  }

  return {
    // 読み取り専用は型の上だけ。書き換えは下の関数を通す
    current,
    version,
    opening,
    error,
    canUndo: historyValue((h) => h.canUndo, false),
    canRedo: historyValue((h) => h.canRedo, false),
    nextUndoLabel: historyValue((h) => h.nextUndo?.label ?? null, null),
    nextRedoLabel: historyValue((h) => h.nextRedo?.label ?? null, null),
    unsavedChanges: historyValue((h) => h.unsavedChanges, 0),
    openFile: (file) => load(file.name, () => file.arrayBuffer()),
    openBytes: (fileName, data) => load(fileName, async () => data),
    setBlueprint,
    close() {
      openToken++
      opening.value = false
      replace(null)
    },
    markExported(doc, at) {
      doc.history.markSaved(at)
    },
    apply(cmd) {
      const doc = current.value
      if (!doc || !cmd) return false
      doc.history.apply(cmd)
      relocated(cmd, true)
      return true
    },
    undo: () => relocated(current.value?.history.undo() ?? null, false),
    redo: () => relocated(current.value?.history.redo() ?? null, true),
    clearError() {
      error.value = null
    },
    onRelocate,
    onCommand,
  }
}

/** provide / inject の鍵。テストでは別の DocumentSession を provide して使う */
export const DOCUMENT_SESSION_KEY: InjectionKey<DocumentSession> = Symbol('DocumentSession')

let appSession: DocumentSession | null = null

/**
 * 開いている設計図を受け取る。部品の setup の中で呼ぶ。
 * provide されていなければ、アプリ全体で1つの DocumentSession を返す。
 */
export function useDocumentSession(): DocumentSession {
  const provided = hasInjectionContext() ? inject(DOCUMENT_SESSION_KEY, null) : null
  if (provided) return provided
  appSession ??= createDocumentSession()
  return appSession
}

/** 子の部品に session を渡す（テストや、別の設計図を並べるとき） */
export function provideDocumentSession(session: DocumentSession): void {
  provide(DOCUMENT_SESSION_KEY, session)
}
