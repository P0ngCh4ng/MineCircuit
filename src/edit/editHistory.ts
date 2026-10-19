import type { Blueprint } from '../domain/blueprint'
import type { CellValue } from '../domain/blockVolume'
import type { Vec3 } from '../domain/vec3'
import type { EditCommand } from './editCommand'
import { Signal } from './signal'

// 設計図全体の座標 pos に cell を書き込む。BlockVolume.setCell を呼ぶのはここだけ（設計のルール 6）
function writeCell(bp: Blueprint, pos: Vec3, cell: CellValue): void {
  const loc = bp.locate(pos)
  if (!loc) {
    throw new Error(`位置 [${pos.join(', ')}] は設計図の範囲の外です。範囲の中を指定してください。`)
  }
  loc.region.setCell(loc.local[0], loc.local[1], loc.local[2], cell)
}

/**
 * 編集の履歴。操作を設計図に書き込み、元に戻す・やり直すを受け持つ。
 * 変更のたびに onChange で合図する（集計・3D 表示・計算の更新に使う）。
 */
export class EditHistory {
  private readonly undoStack: EditCommand[] = []
  private readonly redoStack: EditCommand[] = []
  /** 画面・集計・計算の再実行の合図 */
  readonly onChange = new Signal<void>()

  constructor(private readonly bp: Blueprint) {}

  /** after を書き込み、元に戻す側に積む。やり直す側は空にする */
  apply(cmd: EditCommand): void {
    for (const change of cmd.changes) writeCell(this.bp, change.pos, change.after)
    this.undoStack.push(cmd)
    this.redoStack.length = 0
    this.onChange.emit()
  }

  /** 最後の操作の before を書き戻す。戻せる操作がなければ null */
  undo(): EditCommand | null {
    const cmd = this.undoStack.pop()
    if (!cmd) return null
    // 同じマスを2回変える操作でも元に戻るよう、逆の順に書き戻す
    for (let i = cmd.changes.length - 1; i >= 0; i--) {
      const change = cmd.changes[i]
      writeCell(this.bp, change.pos, change.before)
    }
    this.redoStack.push(cmd)
    this.onChange.emit()
    return cmd
  }

  /** 最後に元に戻した操作をもう一度書き込む。やり直せる操作がなければ null */
  redo(): EditCommand | null {
    const cmd = this.redoStack.pop()
    if (!cmd) return null
    for (const change of cmd.changes) writeCell(this.bp, change.pos, change.after)
    this.undoStack.push(cmd)
    this.onChange.emit()
    return cmd
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** 次に元に戻す操作。ボタンのツールチップに label を出す */
  get nextUndo(): EditCommand | null {
    return this.undoStack.at(-1) ?? null
  }

  /** 次にやり直す操作 */
  get nextRedo(): EditCommand | null {
    return this.redoStack.at(-1) ?? null
  }

  /** 画面の「編集 n 回」。今の設計図に入っている操作の数 */
  get count(): number {
    return this.undoStack.length
  }
}
