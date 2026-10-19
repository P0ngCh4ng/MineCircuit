# MineCircuit 開発ガイド

工業Mod（Createなど）の設計図を、ゲームの外で確認・編集・計算するWebアプリ。サーバーは持たず、ブラウザだけで動く静的サイトとして作る。

実装を始める前に、関係する書類を読むこと。

| 書類 | 内容 |
| --- | --- |
| [docs/spec.md](docs/spec.md) | 仕様。目的、想定ユーザー、機能と優先度、最初の版の範囲 |
| [docs/design.md](docs/design.md) | クラス設計。層、各クラス、値の出どころ、編集、書き出し |
| [docs/ui.md](docs/ui.md) | 画面構成。配置、ツール、キー操作 |
| [docs/create-stress.md](docs/create-stress.md) | Createの応力計算の規則と数値。回転のつながり、速度比、初期値、計算の手順 |
| [prototype/index.html](prototype/index.html) | UIプロトタイプ。1ファイルの参考実装 |

作業は GitHub の Issue 単位で進める。マイルストーン M0〜M5 が仕様書の「開発の順番」に対応する。

## 技術構成

| 用途 | 使うもの | 備考 |
| --- | --- | --- |
| ビルド | Vite 8 系 | |
| 画面 | Vue 3.5 系（Composition API、`<script setup>`） | |
| 状態 | Pinia | 画面の状態だけを持つ。設計図のデータは持たせない（下の「設計のルール」） |
| 言語 | TypeScript 6.0 系、`strict: true` | TypeScript 7 は vue-tsc との組み合わせが未確認のため、確認できるまで使わない |
| 3D | Three.js | |
| jar（zip）の読み込み | fflate | 必要なファイルだけを取り出せる |
| NBT の読み書き | 自前実装（`src/io/nbt/`） | prismarine-nbt は Node の Buffer 前提のため使わない。プロトタイプの実装を元にする |
| テスト | Vitest | 画面の部品のテストは @vue/test-utils と happy-dom |
| 型チェック | vue-tsc | |
| Lint | ESLint | |

バージョンは雛形を作るときに `package.json` で固定する。公開から2週間以内の版は避ける。

## コマンド

```
npm install        # 依存を入れる（バージョンは package.json で固定。.npmrc で save-exact）
npm run dev        # 開発サーバー（Vite）
npm run typecheck  # 型チェック（vue-tsc -b）
npm run build      # 本番ビルド（型チェックのあと vite build。出力は dist/）
npm run preview    # ビルド結果の確認
npm run test       # テスト（Vitest）。src/**/*.test.ts と tests/**/*.test.ts
npm run lint       # Lint（ESLint）。層と依存の向きも調べる（eslint-rules/layer-dependency.js）
```

作業を終える前に `test`・`typecheck`・`lint` を通すこと。

## フォルダ構成

設計書の層をそのままフォルダにする。依存は上から下への一方向だけ。下の層から上の層を import しない。

```
src/
  domain/      データの型。ResourceLocation, BlockState, Blueprint, BlockVolume。他の層に依存しない
  io/          読み込み・書き出し。nbt/, readers/, writers/, modpack/, FileSource, FileSink
  edit/        編集の操作と履歴。EditCommand, EditHistory, BlockBrush
  analysis/    集計・検索・計測。BlueprintStats, BlockSearch, measure
  calc/        計算プラグイン。CalcPlugin, Provenance, 各Modのプラグイン
  view/        画面。Vue の部品、Three.js の描画、ツール、Pinia のストア
  workers/     Web Worker（Modpack の読み込み、計算）
tests/
  fixtures/    テスト用の設計図を作るヘルパー
```

`view/` 以外は Vue と Three.js に依存させない。こうすると、読み込み・編集・計算を画面なしでテストできる。

各層が import してよいのは、自分と、この一覧で自分より上にある層だけ（domain ← io ← edit ← analysis ← calc）。view と workers はその5つを使える。view は workers も使える。Vue・Three.js・Pinia は view の中だけ。破ると `npm run lint` が失敗する。

## 設計のルール

設計書の「基本方針」の要約。迷ったら設計書を読むこと。

1. **設計図ファイル1つだけで動く。** Modpack、設定、計算プラグインは、なくても動くように作る。型は `Modpack | null` のように「ない場合」を必ず扱う。
2. **ファイルにあるものは捨てない。** 解釈できない項目、生データ（nbt）、エンティティ、Mod が足した一番上の項目をそのまま持ち、書き出しで元に戻す。
3. **読み込みと解釈を分ける。** `Blueprint` / `BlockVolume` は「ファイルに何が入っているか」だけを表す。Mod ごとの意味づけは計算プラグインの中で行う。
4. **値には出どころを付ける。** 計算に使う値は `Resolved<T>`（`blueprint` / `modpack` / `builtin` / `virtual` / `assumed`）で返す。
5. **分からないものは仮定として記録する。** 推測で埋めた値は、計算結果の仮定一覧に載せる。
6. **設計図の変更は編集の操作を通す。** `BlockVolume.setCell` を呼んでよいのは `edit/` だけ。画面やプラグインから直接書き換えない。
7. **重い処理は Web Worker で行う。** Modpack の読み込みと計算は画面を止めない。

## データと権利のルール

リポジトリは公開している。次を守ること。

- Minecraft 本体と各 Mod のテクスチャ・モデル・翻訳ファイル・jar を、リポジトリにもアプリにも入れない。アプリは利用者の PC にあるファイルを、その場で読むだけにする。
- 利用者のファイルはブラウザ内だけで処理し、外部に送信しない。外部への通信を足すときは、先に確認を取ること。
- 他人が作った設計図（Modpack 付属の例を含む）をリポジトリに入れない。テスト用の設計図はコードで生成する（`tests/fixtures/`）。
- Mod の数値（応力の初期値など）をアプリに入れるときは、出典とライセンスを README の「注記」に書く。
- 画面と README に、非公式ツールであることを書いておく。Minecraft のロゴは使わない。

## テスト

次は必ずテストを書く。壊れると設計図のデータが失われる部分だから。

- NBT：全タグ型の読み書き。書き出して読み直すと元と一致すること
- 設計図の読み込み：`palette` / `palettes` の両方、知らない項目が残ること、生データが残ること
- 書き出し：読み込み → 書き出し → 読み込みで、配置・状態・生データ・知らない項目が一致すること
- 編集：操作のあとに元に戻すと、完全に元の状態になること。やり直しも同じ
- 回転：`axis` / `facing` / `horizontal_facing` の各規則

テスト用の設計図は `tests/fixtures/` のヘルパーで作る。必要ならテスト中に NBT へ書き出して使う。

## コードの書き方

- 識別子（クラス名、関数名、変数名）は英語。コメント、画面の文言、書類は日本語。
- `any` を使わない。NBT の生データは `RawNbt` 型で扱う。
- 座標は `Vec3`（`[x, y, z]`）。y が上下（段）。Minecraft と同じ向き。
- 画面の文言は短い文で、具体的に書く。ボタンは操作をそのまま書く（「書き出し（.nbt）」「元に戻す」）。エラーは何が起きたかと、どうすればよいかを書く。

## 用語の対応

画面・書類の言葉と、コードの名前をそろえる。

| 画面・書類 | コード | 意味 |
| --- | --- | --- |
| 設計図 | `Blueprint` | 設計図ファイル1つ分 |
| リージョン | `BlockVolume` | 1つの領域のブロック配置。.nbt は常に1つ |
| 段 | `layer`（値は y） | 高さ1ブロック分の水平な面。画面では1始まり、コードでは y（0始まり） |
| ブロック状態 | `BlockState` | ID と properties（`axis=y` など） |
| 生データ | `blockEntity`（型は `RawNbt`） | ブロックエンティティの NBT |
| パレット | `palette` | 設計図に出てくるブロック状態の一覧 |
| 置くブロック | `BlockBrush` | 置くツールで使うブロック状態 |
| 編集の操作 | `EditCommand` | 元に戻せる変更1つ |
| 仮の入出力 | `VirtualPort` | 利用者が設計図の端に置く、仮の動力源や負荷 |
| 出どころ | `Provenance` | 値がどこから来たか |
| 足りないMod | `missingNamespaces` | Modpack にない namespace |

## 作業の進め方

- 1つの Issue につき1つのブランチ。名前は `issue-<番号>-<短い英語>`（例: `issue-4-nbt-reader`）。
- コミットメッセージは英語で、何をしたかを1行目に書く。Issue 番号を入れる（`Add NBT reader (#4)`）。
- プルリクエストを作り、本文に `Closes #<番号>` と、確かめたことを書く。
- 仕様や設計と違う作り方をしたくなったら、先に書類を直す提案をする。黙って変えない。
- プロトタイプは参考にしてよいが、まとめて写さない。この書類の層に分けて作り直す。
