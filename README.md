# MineCircuit

工業Mod（Createなど）の設計図を、ゲームの外で確認・編集・計算するWebアプリ。

- 設計図を3Dと2Dで表示し、1段ずつ中身を確認する
- ブロック数と寸法を数え、2点間の距離を測る
- ブロックを置く・消す・回転し、.nbt で書き出す
- Modpackのフォルダを読み込み、ブロック名の表示と足りないModの検出をする
- Modごとの計算プラグインで、応力などを計算する（予定）

ファイルはブラウザ内だけで処理し、外部に送信しない。

![MineCircuit の画面](docs/images/ui-edit-3d.png)

- 仕様: [docs/spec.md](docs/spec.md)
- クラス設計: [docs/design.md](docs/design.md)
- 画面構成: [docs/ui.md](docs/ui.md)
- UIプロトタイプ: [prototype/index.html](prototype/index.html)（ChromeかEdgeで開く）
