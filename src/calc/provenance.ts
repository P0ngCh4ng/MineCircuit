// 値の出どころ（docs/design.md「値の出どころ」）。
// 計算に使う値には、どこから来たかを付けて返す。優先順に値を探す処理もここに置き、
// 各プラグインは「どこから値を引くか」の規則と「内蔵の初期値」だけを書く。

/** 値がどこから来たか */
export type Provenance =
  /** 設計図の nbt やブロック状態から読んだ */
  | 'blueprint'
  /** Modpack の設定ファイルから読んだ */
  | 'modpack'
  /** アプリ内蔵の初期値 */
  | 'builtin'
  /** 利用者が置いた仮の入出力 */
  | 'virtual'
  /** 情報がなく、アプリが仮定した */
  | 'assumed'

/** 画面に出す並び（信頼できる順） */
export const PROVENANCES: readonly Provenance[] = ['blueprint', 'modpack', 'builtin', 'virtual', 'assumed']

/** 画面に出す出どころの名前 */
export const PROVENANCE_LABELS: Readonly<Record<Provenance, string>> = {
  blueprint: '設計図',
  modpack: 'Modpack',
  builtin: '内蔵の初期値',
  virtual: '仮の入出力',
  assumed: '仮定',
}

/** 出どころ付きの値 */
export interface Resolved<T> {
  readonly value: T
  readonly source: Provenance
  /** 「範囲外は空気とみなした」など。画面に添えて出す */
  readonly note?: string
}

/** 出どころ付きの値を作る */
export function resolved<T>(value: T, source: Provenance, note?: string): Resolved<T> {
  return note === undefined ? { value, source } : { value, source, note }
}

/** 値の出どころ（候補）1つ分。値がなければ null か undefined を返す */
export interface ValueCandidate<T> {
  readonly source: Provenance
  readonly get: () => T | null | undefined
  readonly note?: string
}

/**
 * 候補を作る。get が null / undefined を返したら次の候補に進む。
 * 値の型は null / undefined を除いたもの（常に null を返す候補は ValueCandidate<never> になり、どの型の一覧にも入る）
 */
export function candidate<T>(
  source: Provenance,
  get: () => T | null | undefined,
  note?: string,
): ValueCandidate<NonNullable<T>> {
  const g = get as () => NonNullable<T> | null | undefined
  return note === undefined ? { source, get: g } : { source, get: g, note }
}

/**
 * 候補を前から順に調べ、最初に値があったものを返す。どれにもなければ null。
 * 最後に必ず値がある候補（内蔵の初期値など）を置くときは resolveWith を使う。
 */
export function resolveFirst<T>(candidates: readonly ValueCandidate<T>[]): Resolved<T> | null {
  for (const c of candidates) {
    const value = c.get()
    if (value !== null && value !== undefined) return resolved(value, c.source, c.note)
  }
  return null
}

/**
 * 候補を順に調べ、どれにもなければ fallback を使う。
 * fallback の出どころが 'assumed' なら、計算結果の仮定一覧に載せること（AssumptionLog）。
 */
export function resolveWith<T>(candidates: readonly ValueCandidate<T>[], fallback: Resolved<T>): Resolved<T> {
  return resolveFirst(candidates) ?? fallback
}
