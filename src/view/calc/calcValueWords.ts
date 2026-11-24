// 説明の文に入れる「計算の値」の言い方（#267）。プラグインが返す値の名前から作り、Mod ごとの言葉を画面に固定しない。

/** 文に入れる値の名前の数。多いときは先頭だけ出して「など」を付ける */
const MAX_WORDS = 2

/**
 * 値の名前を文に入れる形にする。["回転数", "応力", "輸送量"] なら「回転数・応力など」。
 * 名前がまだなければ（計算の前、計算できるプラグインがない）「計算の値」
 */
export function calcValueWords(labels: readonly string[]): string {
  if (labels.length === 0) return '計算の値'
  const words = labels.slice(0, MAX_WORDS).join('・')
  return labels.length > MAX_WORDS ? `${words}など` : words
}
