# MineCircuit

工業Mod（Createなど）の設計図を、ゲームの外で確認・編集・計算するアプリ。ブラウザ版と、Windows用のデスクトップ版（予定）がある。

- 設計図を3Dと2Dで表示し、1段ずつ中身を確認する
- ブロック数と寸法を数え、2点間の距離を測る
- ブロックを置く・消す・回転し、.nbt で書き出す
- Modpackのフォルダを読み込み、ブロック名の表示と足りないModの検出をする
- Modごとの計算プラグインで、応力などを計算する（予定）

ファイルは利用者のPCの中（ブラウザ版はブラウザ内）だけで処理し、外部に送信しない。デスクトップ版も通信しない。

デスクトップ版のインストーラーはコード署名をしていないため、Windowsが警告を出すことがある。

デスクトップ版は [GitHub のリリース](https://github.com/P0ngCh4ng/MineCircuit/releases) に置く（Windows 用の .msi と .exe）。自分でビルドするときは、Rust（rustup）と Visual Studio の C++ ビルドツールを入れて `npm install` のあと `npm run tauri:build` を実行する。

![MineCircuit の画面](docs/images/ui-edit-3d.png)

- 仕様: [docs/spec.md](docs/spec.md)
- クラス設計: [docs/design.md](docs/design.md)
- 画面構成: [docs/ui.md](docs/ui.md)
- UIプロトタイプ: [prototype/index.html](prototype/index.html)（ChromeかEdgeで開く）
- 開発ガイド（Claude Code 用）: [CLAUDE.md](CLAUDE.md)

## ライセンス

[MIT License](LICENSE)

## 注記

MineCircuit は非公式のツールです。Mojang Studios・Microsoft、および Create をはじめとする各Modの作者とは関係がなく、承認も受けていません。

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.

- Minecraft および各Modのテクスチャ・モデル・翻訳ファイルなどは、このリポジトリにもアプリにも含めません。アプリは、利用者のPCにあるファイルをその場で読み込むだけで、外部に送信しません。
- Minecraft は Mojang Synergies AB の商標です。各Modの名前・データの権利は、それぞれの作者に帰属します。
- 計算に使う各Modの初期値などをアプリに含める場合は、出典とライセンスをこのファイルに記載します。
  - Create の応力の初期値・回転数（[docs/create-stress.md](docs/create-stress.md)、`src/calc/create/createDefaults.ts`）：[Create](https://github.com/Creators-of-Create/Create)（Copyright (c) The Create Team / The Creators of Create）と [Create Fabric](https://github.com/Fabricators-of-Create/create)（Copyright (c) 2019 simibubi）のソースコードから読み取った数値。どちらもコードは MIT License。Create のアセット（`src/main/resources/assets/`）は All Rights Reserved で、このアプリには含めません。
  - Create のベルトとブレイズバーナーの部品のモデルの選び方（`src/io/assets/partialModels.ts`）：上と同じ Create・Create Fabric のソースコード（`BeltRenderer`・`BlazeBurnerRenderer`。MIT License）から、どの状態でどの部品のモデルをどの向きで描くかを読み取って書き直したもの。モデルとテクスチャそのものは含めず、利用者の jar から読みます。
  - Custom Machinery の機械の見た目（`src/io/modpack/customMachinery.ts`、`src/io/assets/blockEntityAppearance.ts`）：機械の定義（データパックの `machines/*.json`）の `appearance.block` と、生データの `machineID` の形だけを使い、Modpack にある定義をその場で読みます。定義やモデルはアプリに含めません。
  - Create の輸送量と処理時間（[docs/create-throughput.md](docs/create-throughput.md)、`src/calc/create/createThroughput.ts`）：Create Fabric のソースコード（MIT License）の定数と規則を読み取って書き直したもの。レシピは利用者の Modpack の jar と kubejs/data/ からその場で読み、アプリには入れません。
  - Create の歯車の設置規則と置き方の補助（`src/calc/create/createPlacement.ts`）：Create Fabric のソースコード（`CogWheelBlock.isValidCogwheelPosition`、`CogwheelBlockItem` の placement helper。MIT License）の規則を読み取って書き直したもの。
