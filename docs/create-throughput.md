# Create の輸送量と処理時間の仕様

作成日: 2026-10-27 / Issue: #125 / 設計: [design.md](design.md) / 回転の計算: [create-stress.md](create-stress.md)

Create の物を運ぶブロックが1秒に何個運べるか（輸送量）と、機械が1回の処理にかかる時間（処理時間）の規則を、Create のソースコードから読み取ってまとめる。回転数は応力の計算（create-stress.md）の結果を使う。コードは写さず、規則だけを書く。

## 対象と出典

| 環境 | 読んだソース |
| --- | --- |
| Create Astral（Fabric 1.18.2） | [Fabricators-of-Create/create](https://github.com/Fabricators-of-Create/create) の `mc1.18/fabric/dev`（commit `80ecefb`、`mod_version = 0.5.1-i`） |
| ATM10（NeoForge 1.21.1、Create 6.0） | [Creators-of-Create/Create](https://github.com/Creators-of-Create/Create) の `mc1.21.1/dev`（commit `7ff2760`）。違いは下の「バージョンの違い」 |

- Create のコードは MIT License。数値はコードの中の定数で、README の注記に出典を書く（create-stress.md と同じ）。
- 以下、ソースのパスは `src/main/java/com/simibubi/create/` からの相対パス。1 tick は 1/20 秒。

## 何を出すか

- **輸送量**：運ぶブロックが、1秒に運べる個数の上限。前後の機械や入れ物の速さで、実際はこれより少なくなる。
- **処理時間**：機械が1回の処理にかかる時間と、1分に処理できる個数の上限。材料の供給が止まらない場合の値。
- どちらもプローブ（ブロックの値）に出す。設計図全体の生産量（流れの計算）は、この版では出さない（下の「この版で扱わないもの」）。
- 計算に使った値には出どころを付ける。回転数の出どころ、設定ファイル、レシピ、仮定の値。

## 設定ファイルの項目

`create-server.toml`（create-stress.md「設定ファイルの場所」と同じファイル）から読む。なければ初期値。

| 項目 | 初期値 | 使う所 |
| --- | --- | --- |
| `logistics.defaultExtractionTimer` | 8（tick） | ファンネルが取り出す間隔 |
| `recipes.bulkPressing` | false | プレスが1回に押す個数（true ならスタックごと） |

手元の Create Astral（2つのワールド）は、どちらも初期値のまま（2026-10-27 に確認）。

## 輸送

### ベルト（`create:belt`）

- 物は1 tick に |回転数| / 480 ブロック進む。1秒に |回転数| / 24 ブロック。
- 物と物の間は1ブロック空く。1秒に通る数は |回転数| / 24 個（の山）。
- 1つの山の個数は、入れたもので決まる。手やデポから入れたら1個、ファンネルや機械アームから入れたら最大 64 個。
- 出すもの：速さ（ブロック/秒）と、1個ずつのときと 64 個ずつのときの輸送量。
- 出典：`content/kinetics/belt/BeltBlockEntity.java`（`getBeltMovementSpeed`）、`content/kinetics/belt/transport/BeltInventory.java`（間隔）

### 機械アーム（`create:mechanical_arm`）

- 動く速さ：1 tick に min(256, |回転数|) / 1024 ずつ進み、1 で次の位置に着く。1回の移動は ⌈1024 / min(256, |回転数|)⌉ tick。
- 1往復は、取りに行く移動、置く先を探す、置きに行く移動、取る先を探す、の4つ。探す間も進み具合が 1 に着くまで待つので、どれも移動1回分（N tick）かかる。1往復は 4N tick。
  - 置く先を探すのは、11 tick ごとの見直しで、進み具合が 0.5 を過ぎていれば早く終わる。短いときは 3.5N tick。計算では長い方の 4N を使う。
- 1回に取る数は最大 64 個（取る先の入れ物の中身による。6.0 は1つの枠から最大 64 個、置く先が受け取れる数まで）。
- 出すもの：1往復の時間と、1個ずつのときと 64 個ずつのときの輸送量。
- 出典：`content/kinetics/mechanicalArm/ArmBlockEntity.java`（`chasedPointProgress`）、`ArmInteractionPoint.java`（`extract` の 64）

### ファンネル（`create:andesite_funnel`, `create:brass_funnel`）

- 入れ物から取り出すとき、`defaultExtractionTimer`（初期値 8 tick）ごとに1回取り出す。
- 1回の数：安山岩のファンネルはフィルターが使えないので **1 個**。真鍮のファンネルは、フィルターの数（生データの `FilterAmount`。0 か、なければ 64）。
- 64 個になるのは、フィルターの数が使えない置き方のとき（ベルトに押し出さないベルトのファンネルなど）。この版ではベルトのファンネル（`*_belt_funnel`）は扱わない。
- 出すもの：1回の数と間隔、輸送量の上限（数 × 20 / 間隔 個/秒）。
- 回転とは関係ないので、回転数がなくても出す。
- 出典：`content/logistics/funnel/FunnelBlockEntity.java`（`getAmountToExtract`、`extractionCooldown`）、`foundation/blockEntity/behaviour/filtering/FilteringBehaviour.java`（`FilterAmount`）

### シュート（`create:chute`, `create:smart_chute`）

- 扇風機がなければ、物は重力で1秒に 4 マス落ちる。
- 扇風機の風があれば、風の強さ / 64 マス/秒（最大 20）。この版では扇風機の風は計算せず、重力だけで出す。扇風機がつながっているときは仮定に載せる。
- 1つのシュートには1つの山（最大 64 個）が入る。輸送量は、1個ずつなら 4 個/秒、64 個ずつなら 256 個/秒。
- 出典：`content/logistics/chute/ChuteBlockEntity.java`（`getItemMotion`）

## 機械の処理時間

レシピの処理時間（`processingTime`、tick）を使う機械がある。どのレシピかの決め方は下の「レシピ」。

### メカニカルプレス（`create:mechanical_press`）

- 1回押す動きは 240 進むと終わる。1 tick に ⌊1 + (60 − 1) × min(|回転数| / 512, 1)⌋ 進む。
- 1回で1個を押す。`bulkPressing` が true ならスタックごと。
- 型押し（バサンの上での圧縮）も同じ動き。
- レシピの処理時間は使わない。
- 出典：`content/kinetics/press/PressingBehaviour.java`（`CYCLE = 240`、`getRunningTickSpeed`）

### メカニカルミキサー（`create:mechanical_mixer`）

- 混ぜる時間 P = clamp(⌊log2(⌊512 / |回転数|⌋)⌋ × ⌈r × 15⌉ + 1, 1, 512) tick。r はレシピの処理時間 / 100（処理時間が 0 か書いていなければ 1）。
- 1回の処理は、下ろす 20 tick + P + 上げる 20 tick。1回でレシピ1回分。
- 材料は2つ下のバサンの中身（生データ）から探す。
- 出典：`content/kinetics/mixer/MechanicalMixerBlockEntity.java`（`tick`）

### 石臼（`create:millstone`）

- 1個ごとに、残り時間をレシピの処理時間から始め、1 tick に clamp(⌊|回転数| / 16⌋, 1, 512) ずつ減らす。0 以下で1個できる。
- 出典：`content/kinetics/millstone/MillstoneBlockEntity.java`

### 粉砕ホイール（`create:crushing_wheel`）

- 2つのホイールの間に入ったスタックをまとめて処理する。速さ s = |回転数| / 50 × 4。
- 残り時間をレシピの処理時間から始める。結果ができるまでは、1 tick に clamp(s / ⌊log2(個数)⌋, 0.25, 20) ずつ減らす（1個なら 20）。20 を切ったら結果ができ、そのあとは clamp(s, 0.25, 20) ずつ減らし、0 以下で外に出す。
- 出すもの：1個ずつ入れたときと、64 個まとめて入れたときの時間。
- レシピが分からないときの処理時間は 100（Create のコードの値）。
- 出典：`content/kinetics/crusher/CrushingWheelControllerBlockEntity.java`

### メカニカルソー（`create:mechanical_saw`）

- 入れたスタックをまとめて処理する。時間 = レシピの処理時間 × max(1, ⌊個数 / 5⌋)。
- 1 tick に clamp(|回転数| / 24, 1, 128) ずつ減らし、5 を切ったら結果ができ、残りを 20 にして同じ速さで減らす。
- レシピが分からないときの処理時間は 50（Create のコードの値）。
- 出典：`content/kinetics/saw/SawBlockEntity.java`（`start`、`tick`）

### デプロイヤー（`create:deployer`）

- 速さ v = clamp(|回転数| × 2, 8, 512)。伸びる 1000、縮む 1000、待つ 500 を、1 tick に v ずつ進める。1回で1つの動作。
- レシピの処理時間は使わない。
- 出典：`content/kinetics/deployer/DeployerBlockEntity.java`

## レシピ

石臼・粉砕ホイール・ソー・ミキサーは、レシピの処理時間で速さが変わる。

### 読む場所

| 場所 | 中身 |
| --- | --- |
| Mod の jar の `data/<namespace>/recipes/`（1.21 は `recipe/`） | Mod が持つレシピ |
| Modpack の `kubejs/data/<namespace>/recipes/` | KubeJS のデータパックで足したレシピ。同じ ID なら jar より優先 |

- 処理時間の項目は、1.18 は `processingTime`、1.21（Create 6.0）は `processing_time`。どちらも書いていなければ 0。
- 材料のうち液体（`amount` を持つもの、`fluid`・`fluidTag`）は見ない。
- 読むのは `type` が `create:milling`・`create:crushing`・`create:cutting`・`create:mixing` のものだけ。材料（`ingredients` の `item` と `tag`）と処理時間（`processingTime`）だけを持つ。
- 条件付きのレシピ（`conditions`、`fabric:load_conditions`）の条件は見ない。
- **KubeJS のスクリプト（`kubejs/server_scripts/`）で足した・変えたレシピは読めない。** スクリプトがレシピを変えているとき（`recipes` のイベントがあるとき）は、仮定に載せる。手元の Create Astral は、Create の粉砕・混ぜるレシピをスクリプトで変えている（`server_scripts/recipes/create/` など。2026-10-27 に確認）。
- ワールドのデータパック（`saves/<ワールド>/datapacks/`）は、この版では読まない。

### どのレシピか

1. 機械の生データに入っている物（入れ物の中身）があれば、その ID を材料に持つレシピを使う。タグの材料は調べない。
2. 1 で決まらなければ、その種類のレシピの処理時間の範囲（最短〜最長）を出し、時間はCreate のコードの初期値（石臼・粉砕 100、ソー 50、ミキサー 100 として r = 1）で計算する。初期値を使ったことを仮定に載せる。
3. Modpack がなければ、2 の初期値だけで計算する。

## 例（テスト）

回転数は設定ファイルなしの初期値で、すべて 64 RPM のとき。

| ブロック | 計算 | 結果 |
| --- | --- | --- |
| ベルト | 64 / 24 | 2.67 ブロック/秒。1個ずつなら 2.67 個/秒、64 個ずつなら 171 個/秒 |
| 機械アーム | ⌈1024 / 64⌉ = 16 tick × 4 | 1往復 3.2 秒。1個ずつなら 0.31 個/秒 |
| 安山岩のファンネル | 1 個 / 8 tick | 2.5 個/秒 |
| プレス | ⌊1 + 59 × 0.125⌋ = 8、240 / 8 | 30 tick（1.5 秒）で1個。40 個/分 |
| ミキサー（処理時間なし） | ⌊log2(8)⌋ × 15 + 1 = 46、+ 40 | 86 tick（4.3 秒）で1回。14 回/分 |
| 石臼（処理時間 100） | 100 / 4 | 25 tick（1.25 秒）で1個。48 個/分 |
| 粉砕ホイール（処理時間 100、1個） | 20 ずつ5回で 0、次の tick に外へ | 6 tick で1個 |
| ソー（処理時間 50、1個） | 2.67 ずつ 50→5 未満に17 tick、20→0 に8 tick | 25 tick で1個 |
| デプロイヤー | v = 128。1000/128 → 8、8、500/128 → 4 | 20 tick（1 秒）で1回 |

## バージョンの違い

Create 6.0（1.21.1）のソースと比べた（2026-10-27）。上の規則は Create Fabric 0.5.1 のもので、計算もこちらに合わせる。

| 項目 | Create Fabric 0.5.1（1.18.2） | Create 6.0（1.21.1） |
| --- | --- | --- |
| ミキサーの混ぜる時間 | 上限 512 tick | 上限なし |
| 粉砕ホイールの log2(個数) | 切り捨て（3 個なら 1） | 小数のまま（3 個なら 1.585）。1 個と 64 個では同じ |
| 機械アームの1回の数 | 入れ物全体から最大 64 個 | 1つの枠から最大 64 個、置く先が受け取れる数まで |
| レシピのフォルダ | `recipes/` | `recipe/` |
| 処理時間の項目 | `processingTime` | `processing_time` |
| 液体の材料 | `{ fluid / fluidTag, amount }` | `{ type, tag, amount }` |

ベルト・ファンネル・シュート・プレス・石臼・ソー・デプロイヤーの規則と、`defaultExtractionTimer`・`bulkPressing` の初期値は同じ。

## この版で扱わないもの

- 設計図全体の流れ（どこが詰まるか、1分に何個できるか）。ブロックのつながり（ベルトの上の機械、ファンネルの向き、デポ）を読む必要がある。次の段階でやる。
- 扇風機による処理（洗う・焼く・燻す）と、シュートの扇風機の風。
- 液体（ポンプ・パイプ）の流量。
- KubeJS のスクリプトのレシピ、ワールドのデータパックのレシピ。
- 動く仕掛け（Contraption）のドリルやハーベスター。

## ゲームで確かめる手順

1. 平らなワールドで、クリエイティブのモーターを 64 RPM にする。
2. ベルト 10 ブロックに、ファンネルから丸石を流す。10 ブロックを進む時間を計る（3.75 秒のはず）。
3. 石臼に小麦を 64 個入れ、全部が粉になるまでの時間を計る（Create の小麦のレシピは処理時間 150 なので、1個 ⌈150 / 4⌉ = 38 tick、64 個で約 122 秒）。
4. プレスの下のデポに鉄インゴットを 64 個置き、全部が板になるまでの時間を計る（約 96 秒）。
5. 結果がずれたら、ずれた量をこの書類の「未確認事項」に書く。

## 未確認事項

- 機械アームの1往復が 3.5N と 4N のどちらに近いか（ゲームで計る）。
- ベルトに 64 個の山がそのまま乗るか、ファンネルの1回の数がベルトの空きで減るか。
- ミキサーの1回の前後の tick（下ろす・上げる）の正確な数（±1 tick）。
- ソーがベルトの上の物を処理するときの時間（ベルトの処理は別の経路）。

## 参照したソース

上の各節の「出典」。Fabricators-of-Create/create の commit `80ecefb` と、Creators-of-Create/Create の commit `7ff2760`。パスはどちらも同じ。
