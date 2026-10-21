# MineCircuit

工業Mod（Createなど）の設計図を、ゲームの外で確認・編集・計算するアプリ。ブラウザ版と、Windows用のデスクトップ版（予定）がある。

- 設計図を3Dと2Dで表示し、1段ずつ中身を確認する
- ブロック数と寸法を数え、2点間の距離を測る
- ブロックを置く・消す・回転し、.nbt で書き出す
- Modpackのフォルダを読み込み、ブロック名の表示と足りないModの検出をする
- Modごとの計算プラグインで、応力などを計算する（予定）

ファイルは利用者のPCの中（ブラウザ版はブラウザ内）だけで処理し、外部に送信しない。デスクトップ版も通信しない。

デスクトップ版のインストーラーはコード署名をしていないため、Windowsが警告を出すことがある。

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
