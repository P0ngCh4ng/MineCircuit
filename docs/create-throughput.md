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
- **規則 ID。** 規則ごとに `TP-` で始まる ID を付ける（create-stress.md の `ST-` と同じ決まり。docs/verification.md「3. 規則の一覧」）。出典と確かめた段階は `tests/verification/rules.ts` に持つ。

## 何を出すか

- **輸送量**：運ぶブロックが、1秒に運べる個数の上限。前後の機械や入れ物の速さで、実際はこれより少なくなる。
- **処理時間**：機械が1回の処理にかかる時間と、1分に処理できる個数の上限。材料の供給が止まらない場合の値。
- どちらもプローブ（ブロックの値）に出す。物の入口を置いたときは、ラインの流れ（入る数・出る数）と律速の機械も出す（下の「律速（#168）」）。
- 計算に使った値には出どころを付ける。回転数の出どころ、設定ファイル、レシピ、仮定の値。

## 設定ファイルの項目

`TP-CONFIG` `create-server.toml`（create-stress.md「設定ファイルの場所」と同じファイル）から読む。なければ初期値。

| 項目 | 初期値 | 使う所 |
| --- | --- | --- |
| `logistics.defaultExtractionTimer` | 8（tick） | ファンネルが取り出す間隔 |
| `recipes.bulkPressing` | false | プレスが1回に押す個数（true ならスタックごと） |

手元の Create Astral（2つのワールド）は、どちらも初期値のまま（2026-10-27 に確認）。

## 輸送

### ベルト（`create:belt`）

`TP-BELT-RATE`

- 物は1 tick に |回転数| / 480 ブロック進む。1秒に |回転数| / 24 ブロック。
- 物と物の間は1ブロック空く。1秒に通る数は |回転数| / 24 個（の山）。
- 1つの山の個数は、入れたもので決まる。手やデポから入れたら1個、ファンネルや機械アームから入れたら最大 64 個。
- 出すもの：速さ（ブロック/秒）と、1個ずつのときと 64 個ずつのときの輸送量。
- 出典：`content/kinetics/belt/BeltBlockEntity.java`（`getBeltMovementSpeed`）、`content/kinetics/belt/transport/BeltInventory.java`（間隔）

### 機械アーム（`create:mechanical_arm`）

`TP-ARM-RATE`

- 動く速さ：1 tick に min(256, |回転数|) / 1024 ずつ進み、1 で次の位置に着く。1回の移動は ⌈1024 / min(256, |回転数|)⌉ tick。
- 1往復は、取りに行く移動、置く先を探す、置きに行く移動、取る先を探す、の4つ。探す間も進み具合が 1 に着くまで待つので、どれも移動1回分（N tick）かかる。1往復は 4N tick。
  - 置く先を探すのは、11 tick ごとの見直しで、進み具合が 0.5 を過ぎていれば早く終わる。短いときは 3.5N tick。計算では長い方の 4N を使う。
- 1回に取る数は最大 64 個（取る先の入れ物の中身による。6.0 は1つの枠から最大 64 個、置く先が受け取れる数まで）。
- 出すもの：1往復の時間と、1個ずつのときと 64 個ずつのときの輸送量。
- 出典：`content/kinetics/mechanicalArm/ArmBlockEntity.java`（`chasedPointProgress`）、`ArmInteractionPoint.java`（`extract` の 64）

### ファンネル（`create:andesite_funnel`, `create:brass_funnel`）

`TP-FUNNEL-RATE`

- 入れ物から取り出すとき、`defaultExtractionTimer`（初期値 8 tick）ごとに1回取り出す。
- 1回の数：安山岩のファンネルはフィルターが使えないので **1 個**。真鍮のファンネルは、フィルターの数（生データの `FilterAmount`。0 か、なければ 64）。
- 64 個になるのは、フィルターの数が使えない置き方のとき（ベルトに押し出さないベルトのファンネルなど）。ベルトのファンネル（`*_belt_funnel`）が入れ物から取り出して下に置くとき（`TP-BLOCK-BELT-FUNNEL-PUSH`。#251）も、間隔と数は同じ。
- 出すもの：1回の数と間隔、輸送量の上限（数 × 20 / 間隔 個/秒）。
- 回転とは関係ないので、回転数がなくても出す。
- 出典：`content/logistics/funnel/FunnelBlockEntity.java`（`getAmountToExtract`、`extractionCooldown`）、`foundation/blockEntity/behaviour/filtering/FilteringBehaviour.java`（`FilterAmount`）

### フィルター（#253）

`TP-FILTER`

- 真鍮のファンネル・真鍮のベルトのファンネルは生データの `Filter`、真鍮のトンネルは面ごとの `Filters`（`TP-BRASS-TUNNEL-FILTER`）に、フィルターの物（アイテムスタック）を持つ。安山岩のファンネルにはフィルターがない。
- 空（`id` がない・`minecraft:air`・数（`Count` か `count`）が 0）なら、何でも通す。
- ふつうの物なら、ID が同じ物だけを通す。NBT は比べない（NBT も比べる設定は、この版では扱わない）。
- リストフィルター（`create:filter`）なら、中の物のどれかに合えば通す。通さない一覧（ブラックリスト）なら逆。中の物がなければ、`create:filter` そのものだけを通す。中の物もフィルターとして同じ読み方をする。
  - 1.18.2（0.5.1）：`tag.Items.Items` の各 `id`、`tag.Blacklist`。
  - 1.21.1（6.0）：`components` の `create:filter_items` の各 `item.id`、`create:filter_items_blacklist`。
- 属性フィルター（`create:attribute_filter`）など、ほかのフィルターは読めないので、何でも通すとして仮定に載せる。
- 使う所：入れるファンネル（合わない物は受け取らない）、取り出すファンネル・押し出すベルトのファンネル（合う物だけを取り出す）、取り込むベルトのファンネル（合わない物は下を通り過ぎる）、真鍮のトンネル。
- 出典：`content/logistics/filter/FilterItemStack.java`（`ListFilterItemStack.test`）、`content/logistics/filter/FilterItem.java`（`testDirect`）

### シュート（`create:chute`, `create:smart_chute`）

`TP-CHUTE-RATE`

- 扇風機がなければ、物は重力で1秒に 4 マス落ちる。
- 扇風機の風があれば、風の強さ / 64 マス/秒（最大 20）。この版では扇風機の風は計算せず、重力だけで出す。扇風機がつながっているときは仮定に載せる。
- 1つのシュートには1つの山（最大 64 個）が入る。輸送量は、1個ずつなら 4 個/秒、64 個ずつなら 256 個/秒。
- 出典：`content/logistics/chute/ChuteBlockEntity.java`（`getItemMotion`）

## 機械の処理時間

レシピの処理時間（`processingTime`、tick）を使う機械がある。どのレシピかの決め方は下の「レシピ」。

### メカニカルプレス（`create:mechanical_press`）

`TP-PRESS-TIME`

- 1回押す動きは 240 進むと終わる。1 tick に ⌊1 + (60 − 1) × min(|回転数| / 512, 1)⌋ 進む。
- 1回で1個を押す。`bulkPressing` が true ならスタックごと。
- 型押し（バサンの上での圧縮）も同じ動き。
- レシピの処理時間は使わない。
- 出典：`content/kinetics/press/PressingBehaviour.java`（`CYCLE = 240`、`getRunningTickSpeed`）

### メカニカルミキサー（`create:mechanical_mixer`）

`TP-MIXER-TIME`

- 混ぜる時間 P = clamp(⌊log2(⌊512 / |回転数|⌋)⌋ × ⌈r × 15⌉ + 1, 1, 512) tick。r はレシピの処理時間 / 100（処理時間が 0 か書いていなければ 1）。
- 1回の処理は、下ろす 20 tick + P + 上げる 20 tick。1回でレシピ1回分。
- 材料は2つ下のバサンの中身（生データ）から探す。
- 出典：`content/kinetics/mixer/MechanicalMixerBlockEntity.java`（`tick`）

### 石臼（`create:millstone`）

`TP-MILLSTONE-TIME`

- 1個ごとに、残り時間をレシピの処理時間から始め、1 tick に clamp(⌊|回転数| / 16⌋, 1, 512) ずつ減らす。0 以下で1個できる。
- 出典：`content/kinetics/millstone/MillstoneBlockEntity.java`

### 粉砕ホイール（`create:crushing_wheel`）

`TP-CRUSHING-TIME`

- 2つのホイールの間に入ったスタックをまとめて処理する。速さ s = |回転数| / 50 × 4。
- 残り時間をレシピの処理時間から始める。結果ができるまでは、1 tick に clamp(s / ⌊log2(個数)⌋, 0.25, 20) ずつ減らす（1個なら 20）。20 を切ったら結果ができ、そのあとは clamp(s, 0.25, 20) ずつ減らし、0 以下で外に出す。
- 出すもの：1個ずつ入れたときと、64 個まとめて入れたときの時間。
- レシピが分からないときの処理時間は 100（Create のコードの値）。
- 出典：`content/kinetics/crusher/CrushingWheelControllerBlockEntity.java`

### メカニカルソー（`create:mechanical_saw`）

`TP-SAW-TIME`

- 入れたスタックをまとめて処理する。時間 = レシピの処理時間 × max(1, ⌊個数 / 5⌋)。
- 1 tick に clamp(|回転数| / 24, 1, 128) ずつ減らし、5 を切ったら結果ができ、残りを 20 にして同じ速さで減らす。
- レシピが分からないときの処理時間は 50（Create のコードの値）。
- 出典：`content/kinetics/saw/SawBlockEntity.java`（`start`、`tick`）

### デプロイヤー（`create:deployer`）

`TP-DEPLOYER-TIME`

- 速さ v = clamp(|回転数| × 2, 8, 512)。伸びる 1000、縮む 1000、待つ 500 を、1 tick に v ずつ進める。1回で1つの動作。
- レシピの処理時間は使わない。
- 出典：`content/kinetics/deployer/DeployerBlockEntity.java`

## レシピ

石臼・粉砕ホイール・ソー・ミキサーは、レシピの処理時間で速さが変わる。

### 読む場所

`TP-RECIPE-SOURCES` 次の場所から読む。

| 場所 | 中身 |
| --- | --- |
| Minecraft 本体の jar の `data/minecraft/recipes/`（1.21 は `recipe/`） | 扇風機に使う料理のレシピ（かまど・溶鉱炉・燻製器）と、メカニカルクラフターに使う作業台のレシピ（#235）。同じ ID なら Mod の jar を優先 |
| Mod の jar の `data/<namespace>/recipes/`（1.21 は `recipe/`） | Mod が持つレシピ |
| Modpack の `kubejs/data/<namespace>/recipes/` | KubeJS のデータパックで足したレシピ。同じ ID なら jar より優先 |
| Modpack の `kubejs/server_scripts/` | KubeJS のスクリプト。作り物の KubeJS の上で動かし、レシピを足す・消す・置き換える操作を集めて、上の2つに当てはめる（下の「KubeJS のスクリプトのレシピ」。#145） |

- `TP-RECIPE-TIME-FIELD` 処理時間の項目は、1.18 は `processingTime`、1.21（Create 6.0）は `processing_time`。どちらも書いていなければ 0。
- `TP-RECIPE-INGREDIENTS` 材料のうち液体（`amount` を持つもの、`fluid`・`fluidTag`）は、アイテムの材料には入れない。液体を入れるレシピ（`create:filling`）だけは、液体の材料を別に持つ（液体の ID は `fluid`、タグは 1.18 の `fluidTag`・1.21 の `tag`）。
- 材料の形は（`TP-RECIPE-INGREDIENTS`）`{ item }`・`{ tag }`・その配列のほか、NeoForge のいずれかの材料 `{ type: "neoforge:compound", ingredients: [...] }` の中も読む（Create 6.0 の Mod 連携のレシピ。`create:milling/compat/...` など、Create 6.0.10 の加工のレシピ 553 のうち 353 がこの形。2026-10-28 に確認）。1.21.2 からの文字列の形（`"minecraft:wheat"`、`"#c:crops/wheat"`）も読む。
- `TP-RECIPE-TYPES` 読むのは `type` が `create:milling`・`create:crushing`・`create:cutting`・`create:mixing`・`create:pressing`・`create:compacting`、スパウトとアイテムドレイン（#235）に使う `create:filling`・`create:emptying`、メカニカルクラフター（#235）に使う `create:mechanical_crafting`・`minecraft:crafting_shaped`・`minecraft:crafting_shapeless` と、扇風機の処理（#235。下の「扇風機」）に使う `create:splashing`・`create:haunting`・`minecraft:smelting`・`minecraft:blasting`・`minecraft:smoking` のものだけ。材料（`ingredients` の `item` と `tag`）と処理時間（`processingTime`）とできる物（`results`）だけを持つ。
- `TP-RECIPE-TYPES` Minecraft の料理のレシピ（`minecraft:smelting` など）は、材料が `ingredient`（1つの材料か、そのどれか）、できる物が `result`（1.18 は ID の文字列で1個、1.21 は `{ id, count }`。`{ item, count }` も読む）。処理時間（`cookingtime`）は扇風機では使わないので読まない。
- `TP-RECIPE-CRAFTING` 作業台のレシピとメカニカルクラフターのレシピは、材料の並びも持つ。
  - 形のあるもの（`crafting_shaped`・`mechanical_crafting`）：`pattern`（上の行から、1文字が1マス、空白は空き）と `key`（文字 → 材料）。
  - 形のないもの（`crafting_shapeless`）：`ingredients`（材料1つが1マス）。
  - 材料は `{ item }`・`{ tag }`・そのどれか（配列）・文字列（1.21.2 から）。できる物は `result`（1.18 は `{ item, count }`、1.21 は `{ id, count }`）。
  - `mechanical_crafting` の左右を入れ替えた並びを受け付けるか：1.18 は `acceptMirrored`、6.0 は `accept_mirrored`。書いていなければ受け付ける。作業台の形のあるレシピは、いつも受け付ける。
  - 特別なレシピ（`crafting_special_…`・`crafting_decorated_pot` など、並びを持たないもの）は読まない。
- 読む種類を足したときは、保存してある Modpack の読み込みの結果を読み直す（保存の鍵の版を上げる）。
- 条件付きのレシピ（`conditions`、`fabric:load_conditions`）の条件は見ない。
- KubeJS のスクリプト（`kubejs/server_scripts/`）で足した・変えたレシピは、スクリプトを動かして集める（下の「KubeJS のスクリプトのレシピ」）。手元の Create Astral は、Create の処理のレシピのほとんどをスクリプトで足している（2026-10-29 に確認。石臼 約 49・粉砕 約 77・ソー 約 49・ミキサー 約 361・プレス 約 14・圧縮 約 97。`kubejs/data/` のレシピ JSON は 52 個だけ）。
- ワールドのデータパック（`saves/<ワールド>/datapacks/`）は、この版では読まない。

### どのレシピか

1. `TP-RECIPE-BY-PATH` 物の入口からたどって、その機械に届く物が分かれば（下の「物の通り道」）、それを材料に持つレシピを使う。
2. `TP-RECIPE-BY-CONTENTS` 1 で決まらず、機械の生データに入っている物（入れ物の中身）があれば、それを材料に持つレシピを使う。
3. `TP-RECIPE-TAGS` 材料は、アイテムの ID とタグの両方で照らす。タグは jar・kubejs/data の `data/<ns>/tags/items/`（1.21 は `tags/item/`）を読み、入れ子のタグをたどって平らにしたもの。`replace: true` のファイルは前のファイルの中身を捨てる。KubeJS のスクリプトのタグのイベントで足した・消したものも当てはめる（下の「KubeJS のスクリプトのレシピ」）。
4. `TP-RECIPE-TIE` 材料に合うレシピが2つ以上あれば、レシピの ID の名前順で最初のものを使い、仮定に載せる。
5. `TP-RECIPE-FALLBACK` 1〜4 で決まらなければ、その種類のレシピの処理時間の範囲（最短〜最長）を出し、時間はCreate のコードの初期値（石臼・粉砕 100、ソー 50、ミキサー 100 として r = 1）で計算する。初期値を使ったことを仮定に載せる。プレス・圧縮は処理時間を使わないので、仮定には「レシピが分からない」とだけ書く。
6. `TP-RECIPE-NO-PACK` Modpack がなければ、5 の初期値だけで計算する。

### KubeJS のスクリプトのレシピ（#145）

スクリプトはレシピを配列に並べ、`forEach` でまとめて登録することが多い（Create Astral の `recipes/create/milling.js` など）。文字列を探すだけでは取れないので、スクリプトを作り物の KubeJS の上で動かし、呼ばれた操作を集める。動かし方と安全の決まりは [design.md](design.md)「KubeJS のスクリプトを動かす」。

**動かす順。** `TP-KJS-ORDER` `kubejs/server_scripts/` の下の `.js` を、全部同じ1つの大域の中で、次の順に動かす。

- 先頭のコメント `// priority: <数>` の大きいものから。書いていなければ 0。同じなら、`server_scripts/` からのパスの名前順（大文字と小文字は区別しない）。
- `// ignored: true`（`ignore` も）のファイルは動かさない。`// requires: <modId>`（1.21 の KubeJS）の Mod が Modpack になければ動かさない。
- 先頭のコメントは、ファイルの頭の `//` の行だけを読む（空行は飛ばす）。
- この順と、ファイルどうしで大域を1つにすることは、KubeJS のソースで確かめた（`ScriptFile.compareTo`・`ScriptFileInfo`・`ScriptManager`。ブランチ 1802 と 2101。2026-10-29）。1.18 はパスではなくフォルダをたどった順で並べるが、Windows ではほぼ名前順になる。

**イベント。** `TP-KJS-EVENTS` 登録だけを受け付け、レシピとタグのイベントだけを、全ファイルを動かし終えてから呼ぶ。先にタグのイベントを、次にレシピのイベントを、それぞれ登録した順に呼ぶ（ゲームもタグを先に読む）。ほかのイベント（プレイヤー・ブロック・コマンドなど）は呼ばない。

| 書き方 | KubeJS の版（Minecraft） | 呼ぶもの |
| --- | --- | --- |
| `onEvent('recipes', fn)` | 1.18 | レシピ |
| `onEvent('item.tags', fn)` / `onEvent('tags.items', fn)` | 1.18 | アイテムのタグ |
| `ServerEvents.recipes(fn)` | 1.19〜1.21 | レシピ |
| `ServerEvents.tags('item', fn)` | 1.19〜1.21 | アイテムのタグ |

**レシピのイベントで扱う呼び出し。** `TP-KJS-RECIPE-CALLS` レシピは、この節の上の「読む場所」と同じ形（材料・処理時間・できる物）に直す。読むのは同じ種類だけ。

| 呼び出し | すること |
| --- | --- |
| `event.recipes.createMilling(出る物, 材料)` など（`create` + 種類の名前。`createSplashing`・`createHaunting` も） | レシピを足す。1.18 の kubejs-create の書き方 |
| `event.recipes.create.milling(出る物, 材料)` など | レシピを足す。1.19 からの書き方 |
| `event.smelting(出る物, 材料)`・`event.blasting(…)`・`event.smoking(…)`、`event.recipes.minecraft.smelting(…)` など | 料理のレシピを足す（扇風機の処理に使う。#235）。出る物は1つ |
| 上の2つに続く `.processingTime(n)`・`.id(id)` | 処理時間・ID を決める。`.heatRequirement(…)` など、ほかは何もしない。`.processingTime` を呼ばなければ 100（kubejs-create の初期値。1802 の `ProcessingRecipeJS`、2001 の `ProcessingRecipeSchema`） |
| `event.custom(json)` | JSON を、jar のレシピ JSON と同じ読み方で読む |
| `event.remove(条件)` | 条件に合うレシピを消す |
| `event.replaceInput(条件, 元, 先)`・`event.replaceOutput(条件, 元, 先)` | 条件に合うレシピの材料・できる物を置き換える |

- `TP-KJS-ITEMS` 出る物・材料には、文字列（`"minecraft:stone"`、`"3x minecraft:stone"`、`"#c:ores/iron"`）、`Item.of(id, 数)`、`.withChance(確率)`、`Ingredient.of(…)`、`CreateItem.of(id, 確率)`（1.21）、`{ item, count, chance }`、`{ tag }`、それらの配列を受け付ける。液体（`Fluid.of(…)`、`{ fluid, amount }`）は、ファイルのレシピと同じく見ない。
- `TP-KJS-UNKNOWN-ITEM` 物の知らない項目（`.ignoreNBT()`・`.or(…)` など）は、物をそのまま返す。`Ingredient.of(/正規表現/)` は空の物にして、仮定に載せる。
- `TP-KJS-FILTERS` 条件（`event.remove` などの1つ目）は、`id`・`type`・`output`・`input`・`mod` と、その配列（どれか）・オブジェクト（全部）・`{ not: … }` を扱う。照らす相手は、その時点のすべてのレシピ（jar・kubejs/data・それまでにスクリプトで足したもの）。知らない項目のある条件は、何も消さずに仮定に載せる。
- `TP-KJS-IDS` 操作は呼ばれた順に当てはめる。ID を決めずに足したレシピの ID は `kubejs:script/<ファイルのパス（.js なし）>/<その中の番号>` にする。
- `TP-KJS-REPLACE` 置き換えは、材料の ID か同じタグが元と同じものだけを替える（元のアイテムを含むタグの材料は替えない）。できる物はアイテムの ID だけを替える。2つの引数の古い書き方（`event.replaceInput(元, 先)`）は、すべてのレシピが相手。
- `TP-KJS-FOR-EACH` `event.forEachRecipe`・`event.findRecipes` は、読む種類のレシピだけを渡す。ほかの種類（Farmer's Delight の料理など）は渡さないので、それを元に作るレシピは集まらない。

**タグのイベントで扱う呼び出し。** `TP-KJS-TAGS` `event.add(タグ, アイテム)`・`event.remove(タグ, アイテム)`・`event.removeAll(タグ)`。jar・kubejs/data のタグを読んだあとに当てはめる。

**作り物の大域。** `TP-KJS-GLOBALS` `Item`・`Ingredient`・`Fluid` のほか、`Platform.isLoaded(modId)` は Modpack の Mod の一覧で答える。`console.log` などは何もしない。`global` は全ファイルで共有するただの入れ物、`settings`（1.18）は読み書きだけを受け付ける。`java(…)`・`Java.loadClass(…)`・`Utils`・`JsonIO`、ほかの Mod が足す大域（`NativeEvents` など、どこにも書いていない名前）、イベントの知らない項目は、何もしない作り物の値を返し、名前を数えて仮定に載せる（「KubeJS のスクリプトの呼び出しのうち、アプリで再現しないもの：…」）。ただし、ホストの機能の名前（`fetch`・`eval`・`Function` など）は、作り物にせず「定義されていない」のままにする。

**うまく動かないとき。**

- `TP-KJS-ERRORS` ファイルを動かしていてエラーが起きたら、そのファイルの残りを飛ばし、次のファイルへ進む。イベントの中のエラーは、そのイベントの残りを飛ばす。どちらもファイルの名前とエラーを仮定に載せる。
- `TP-KJS-TIMEOUT` 全体で時間の上限（20 秒）を超えたら打ち切り、スクリプトの結果は使わない（jar・kubejs/data のレシピだけで計算し、仮定に「KubeJS のスクリプトを使えなかった（…）。スクリプトのレシピは入っていない」と載せる）。
- `startup_scripts/` は動かさないので、そこで `global` に入れた値を使うサーバーのスクリプトは、エラーになることがある（ATM10 の Xycraft など）。
- `TP-KJS-ASSUMPTION` スクリプトを動かして集めたレシピを使ったときは、仮定に「KubeJS のスクリプトのレシピは、アプリの中で作り物の KubeJS を使って集めた。ゲームと違うことがある（足す n・消す m・置き換える k）」と載せる。

**手元の Modpack で動かした結果**（2026-10-29。読む6つの種類のレシピの数。左が jar・kubejs/data だけ、右がスクリプトのあと）：

| Modpack | 石臼 | 粉砕 | ソー | ミキサー | プレス | 圧縮 | スクリプト |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Create Astral（1.18.2、98 ファイル） | 175 → 211 | 170 → 213 | 405 → 448 | 44 → 314 | 38 → 178 | 22 → 88 | 足す 843・消す 245・置き換える 6、エラー 0、約 0.6 秒 |
| ATM10（1.21.1、169 ファイル） | 255 → 255 | 242 → 244 | 33 → 33 | 85 → 85 | 47 → 47 | 14 → 14 | 足す 2、エラー 9（ほかの Mod のレシピの所。Java のオブジェクトと startup_scripts の値を使うもの）、約 0.3 秒 |

## 物の通り道（#127）

`TP-PATH-INPUT` 利用者が仮の入出力「物の入口」（アイテム、入る数 個/秒）をブロックに付けると、そのブロックに物が入ってくるものとして、通り道をたどる。面は選ばない（#195）。物の入口からは、入れ物に直接入れるときと同じく、受け取る面を問わずに入れる（「上から」だけのシュートや、口の前からだけのファンネルにも入る）。出典は `content/` からの相対パス（Create Fabric `80ecefb`）。

### たどり方

- `TP-PATH-LOOP` 「どのブロックに、どの物が、1秒に何個届くか」を1つずつたどる。いまたどっている道の上で、同じブロックに同じ物が2度届いたら、その先はたどらない（輪になった通り道）。枝分かれしてから合流する道は、両方を先へ進める。たどるのは物の入口ごとに 256 か所まで。
- `TP-PATH-RECIPE` 機械に届いたら、レシピを当てて、できる物に変えて先へ進む。できる物が2つ以上あれば、それぞれを進める。数は 個数 × 確率 を掛ける。
- `TP-PATH-NO-RECIPE` レシピのない物が機械に届いたら、そこで止める（ゲームでは機械に入らないか、素通りする）。プローブに「この物のレシピがない」と出す。
- `TP-PATH-SPLIT` 行き先が2つ以上（機械アームの置く先が複数など）なら、入る数を等しく分ける。機械アームの置く先1つずつと、取り出すファンネル（押し出すベルトのファンネルを含む）1つずつを、同じ重みの行き先として数える。
- `TP-PATH-MERGE` 1つのレシピで同じ物が2つの結果に出るとき（小麦粉と、確率付きの小麦粉など）は、1つの流れにまとめる。
- `TP-PATH-MULTI-INGREDIENT` 材料が2つ以上のレシピは、届いた物1個ごとに1回処理するとみなす（同じ材料を何個使うかは、今のレシピの読み方では分からない）。
- `TP-PATH-STOPPED` 回転で動くブロック（ベルト・ソー・粉砕ホイール・機械アーム・手に物を受け取ったデプロイヤー）が止まっていれば、そこで止める。ベルトやデポの上のプレス・デプロイヤーが止まっていれば、処理せずに素通りする（ゲームと同じ）。石臼やベイスンの上の機械が止まっていれば、そこで止める。
- `TP-PATH-BATCH` 粉砕ホイールとソーの「処理できる数」は、64 個まとめて入れたときの値を使う。
- `TP-PATH-OVERFLOW` 機械に届く数が、その機械の処理できる数（「機械の処理時間」の1分あたりの数）を超えたら、計算の問題に「処理が追いつかない」と出す。超えた分は処理されず、できる物の数は処理できる数から計算する。

### ブロックごとの規則

| 規則 | ブロック | 受け取る | 先へ送る |
| --- | --- | --- | --- |
| `TP-BLOCK-BELT` | ベルト（`slope` が `horizontal`・`upward`・`downward`） | どの面からでも | 進む向きに、つながったベルトの端まで進む。進む向きは `facing` の軸の上で、(回転数 < 0) XOR (軸が X) なら負の向き。端の1つ先（高さは端の区間と同じ）のブロックが受け取るなら渡す。空気なら、その下（3段まで）の最初のブロックに落ちるとして、仮定に載せる |
| `TP-BLOCK-BELT-MACHINE` | ベルトの上の機械 | — | 水平の区間の **2段上** のプレス（ベルトの上の押し方、`create:pressing`）・デプロイヤー（`facing=down`。物は変えず、通ったことだけ出す）。間の1段に当たり判定のあるブロックがあれば処理しない |
| `TP-BLOCK-BELT-FUNNEL` | ベルトのファンネル（ベルトの区間の1段上） | — | `shape=pulling`、または平行の形で `facing` が進む向きの逆なら、下を通る物のうちフィルター（`TP-FILTER`）に合う物を取り込み、`facing` の反対側の入れ物に入れる |
| `TP-BLOCK-BELT-FUNNEL-PUSH` | ベルトのファンネル（ベルトの区間かデポの1段上。#251） | — | `shape=pushing`、または平行の形（`retracted`・`extended`）で下のベルトの進む向きが `facing` と同じなら、`facing` の反対側の入れ物からフィルター（`TP-FILTER`）に合う物を取り出し、真下のベルト・デポに置く。真下がベルトでもデポでもなければ取り出さない。`powered=true` なら動かない（`FunnelBlockEntity.determineCurrentMode`・`activateExtractingBeltFunnel`） |
| `TP-BLOCK-DEPOT` | デポ（`create:depot`） | どの面からでも | 2段上のプレス・デプロイヤーで処理する。そのあと、1段上の `pulling` のベルトのファンネル、取り出すファンネル、機械アームで先へ |
| `TP-BLOCK-CHUTE` | シュート（`create:chute`、`smart_chute`） | 上から | 真下のブロックへ（斜めのシュートは `pos.below().relative(facing の反対)`）。扇風機があるときは仮定に載せ、下へ流れるものとする |
| `TP-BLOCK-MILLSTONE` | 石臼 | どの面からでも | `create:milling`。できた物は下のシュート、取り出すファンネル、機械アームで先へ |
| `TP-BLOCK-CRUSHING` | 粉砕ホイールの中心（`crushing_wheel_controller`） | 上から（`facing=down`） | `create:crushing`。真下のブロックへ。水平の `facing` の中心（ベルトの上の粉砕）はこの版では扱わない |
| `TP-BLOCK-SAW` | ソー（`facing=up`） | どの面からでも | `create:cutting`。回転軸が Z（`axis_along_first=false`）なら回転数 > 0 で +X、軸が X なら回転数 > 0 で −Z の隣のブロックへ |
| `TP-BLOCK-BASIN` | ベイスン（`create:basin`） | どの面からでも | 2段上がミキサーなら `create:mixing`、プレスなら `create:compacting`。材料が2つ以上のレシピは、届いた物を材料に持つものを選び、ほかの材料はあるものとして仮定に載せる。`facing` が水平なら `pos.relative(facing).below()` へ、`down` なら取り出すファンネル・機械アーム・下のシュートで先へ |
| `TP-BLOCK-FUNNEL-INSERT` | ファンネル（`extracting=false`） | 口（`facing`）の前から。フィルター（`TP-FILTER`）に合わない物は受け取らない | `facing` の反対側の入れ物に入れる |
| `TP-BLOCK-FUNNEL-EXTRACT` | ファンネル（`extracting=true`、`powered=false`） | — | `facing` の反対側の入れ物から、フィルター（`TP-FILTER`）に合う物を取り出して放り出す。`facing` が上か下なら口の前のブロックへ（前が空気ならその下に落ちる）。水平なら、物はファンネルの中心から口の側へ 0.25、下へ 0.45 の所に出て、ファンネルの真下のブロックに落ちる（口の前のブロックには入らない。#253）（`FunnelBlockEntity.activateExtractor`） |
| `TP-BLOCK-ARM` | 機械アーム | — | 生データの `InteractionPoints`（`Pos` はアームからの相対座標、`Mode` は `TAKE`・`DEPOSIT`）。物がある `TAKE` の点から、すべての `DEPOSIT` の点へ |
| `TP-BLOCK-ARM-BELT` | 機械アーム（`TAKE` の点がベルトの区間。#253） | — | その区間を通る物を1つずつ止めて取る（`mechanicalArm/AllArmInteractionPointTypes.java` の `BeltPoint.keepAlive`）。計算では、アームの手が空いている間だけ止めるので、区間の先へ進む物と、`DEPOSIT` の点1つずつを、同じ重みの行き先として分け（`TP-PATH-SPLIT`）、仮定に載せる。次の区間の真鍮のトンネルに入れずに止まった物（`TP-BRASS-TUNNEL-FILTER`）は、全部取る |
| `TP-BLOCK-INVENTORY` | ほかのブロック（チェスト、`create:item_vault` など） | 入れ物とみなす。ブロックエンティティのないブロックを入れ物とみなしたときは仮定に載せる | 取り出すファンネルと機械アームで先へ。どちらもなければ、そこで止まる（物が溜まる所） |
| `TP-BLOCK-DOUBLE-CHEST` | ラージチェスト（`minecraft:chest`・`trapped_chest` の `type=left`・`right`。#253） | もう片方の半分と1つの入れ物 | もう片方は `type=left` なら `facing` を時計回りに、`right` なら反時計回りに回した向きの隣（同じブロックで `type` が逆のとき）。両方の半分に付いた取り出すファンネル・機械アーム・下のホッパーで先へ（Minecraft の `ChestBlock.getConnectedDirection`） |
| 下の節 | 重さ付きイジェクター・トンネル・ホッパー・スパウト・アイテムドレイン | — | 下の「物の動き（#233）」の「足すブロック」 |
| `TP-BLOCK-DEPLOYER-HAND` | デプロイヤーの手（機械アーム・ファンネルなどが入れたとき。#251） | どの面からでも | 生データの `Mode` が `USE`（なければ `USE`）なら、手の物を2つ先（`pos + 2 × facing`）のブロックに使う。そこがブレイズバーナーなら、燃料として渡す（`TP-BLOCK-BLAZE-BURNER`）。ほかのブロックに使ったときの結果と、`PUNCH` は扱わず、そこで止めて仮定に載せる。1回の動作で1個使うので、処理できる数は `TP-DEPLOYER-TIME` の1分あたりの回数（`DeployerBlockEntity.activate`、`BlazeBurnerBlock.use`） |
| `TP-BLOCK-BLAZE-BURNER` | ブレイズバーナー（`create:blaze_burner`） | どの面からでも（燃料として） | 燃やすので、物はそこでなくなる。先へ送らず、溜まる物にも出る数にも入れない。仮定には載せない |
| `TP-BLOCK-UNKNOWN` | 表にない Create のブロック | — | そこで止め、仮定に載せる |

### 出すもの

- `TP-PATH-PROBE` 物が届いた機械のプローブ：「届く物」（物、1秒あたりの数、どこから）、「レシピ」（使ったレシピとできる物）。処理時間はそのレシピで計算する。
- `TP-PATH-PROBE` 物が溜まる所（先がない入れ物）のプローブ：溜まる物と、1秒あたりの数。
- 出どころは「仮の入出力」（入口の物と数）とレシピの出どころの弱い方。
- `TP-PATH-MOTIONS` 物の流れの表示（docs/ui.md「物の流れ」）に使う、物の動き（どこからどこへ、物、個/秒、速さ）。ベルトは区間ごとに1本。

### 扱わないもの

- 扇風機の風が物を押し流す動き、ベルトの上の粉砕、デプロイヤーの手の物のレシピ（ブレイズバーナーに燃料を入れるのは扱う。`TP-BLOCK-DEPLOYER-HAND`）。届いたら素通りするか止まるとして、仮定に載せる。扇風機の処理（洗う・燻す・焼く・憑依）は扱う（`TP-FAN-RECIPE`）。メカニカルクラフターは扱う（`TP-CRAFTER`）。
- 放り出した物の正確な落ちる先、レッドストーンの状態（保存したときの `powered` を使う。`powered=true` のファンネルは動かない）。
- ブロックの当たり判定。空気とベルトのファンネル以外は、当たり判定があるとみなす。
- 受け取る面：機械アーム・ファンネル・ベイスンが入れるときは、入れ物に直接入れるので面を問わない。シュートと粉砕ホイールが面で受け取るのは上からだけ。水平の `facing` のベイスンの出す先が空気なら、ベイスンに溜まるとして仮定に載せる。

## 物の動き（#233）

物の流れの表示（docs/ui.md「物の流れ」）で、物の印をいつ、どこに置くかの規則。上の「物の通り道」で決めた「どこからどこへ、1秒に何個」に、ブロックごとの動き方とかかる時間を足す。印の位置は見た目のためのもので、輸送量・律速・届く数の計算には使わない。

数値は Create Fabric（`80ecefb`）から読んだ。Create 6.0（`7ff2760`）と違うものは、その行に書き添える。書いていないものは同じ。出典のパスは `content/` からの相対パス。

### 共通の規則

- `TP-MOTION-SHAPE` 物の動きは「どこから」「どこへ」「かかる時間」「道の形」で表す。道の形は、まっすぐ・弧（機械アーム）・放物線（イジェクター、放り出した物）の3つ。
- `TP-MOTION-WAIT` 機械で処理する間やデポで止まる間は、同じ場所にとどまる動きにする。待つ時間は上の「機械の処理時間」の1回分。届く数が処理できる数を超えても、待つ時間は1回分のままにする（詰まりは出さない）。
- `TP-MOTION-INSTANT` 移動しない受け渡し（ファンネルが後ろの入れ物に入れるなど）は、時間 0 の動きにする。印はその場で次のブロックに移る。
- `TP-MOTION-INVENTORY` 入れ物（チェスト、`create:item_vault` など）の中は描かない。入った印は消え、取り出すブロックの所に現れる。
- `TP-MOTION-THROWN` 放り出した物（ワールドに物として出たもの）は、Minecraft の落ちる物と同じに動かす。1 tick ごとに下向きの速さから 0.04 を引き、速さ全体に 0.98 を掛ける。落ちる先は「物の通り道」と同じ（真下の最初のブロック）で、そこに着くまでの時間をこの式で出す。
- `TP-MOTION-STOPPED` 回転数が 0 のブロックは動かさない（「物の通り道」と同じく、そこで止まる）。

### 今たどっているブロック

| 規則 | ブロック | 動き | 時間 |
| --- | --- | --- | --- |
| `TP-MOTION-FUNNEL-INSERT` | ファンネル（入れる） | 口の前の物を、後ろの入れ物に入れる | 0 |
| `TP-MOTION-FUNNEL-EXTRACT` | ファンネル（取り出す） | 入れ物から取り出し、口の前に置く。前がベルト・デポなら載せ、空気なら放り出す | 取り出す間隔は `defaultExtractionTimer`（8 tick）。動きは 0 |
| `TP-MOTION-BELT-FUNNEL` | ベルトのファンネル | 下のベルトの物が、区間の真ん中を過ぎたときに取り込む。`shape=extended` なら、区間の手前の端（真ん中から 0.499 手前）で取り込む | 0 |
| `TP-MOTION-CHUTE` | シュート | 上の端から下の端へ、まっすぐ落ちる。下のシュートには続けて渡す。下が空気なら、下向き 0.25 ブロック/tick で放り出す。上が入れ物なら、空いたときに取り出す（シュートは 16 個、スマートシュートはフィルターの数。数がなければ 64 個） | 1マス 1/4 秒（4 マス/秒）。扇風機の風があれば（押す強さ + 引く強さ）/ 64 マス/秒（最大 20）だが、この版では風は計算しない |
| `TP-MOTION-DEPLOYER-HAND` | デプロイヤーの手 | 受け取った物を手に持ち、1回の動作（伸びる・縮む・待つ）のあいだその場にとどまり、2つ先のブロックへ移る（#251） | `TP-DEPLOYER-TIME` の1回分。移るのは 0 |
| `TP-MOTION-ARM` | 機械アーム | 取る点で物をつかみ、置く点まで弧を描いて運ぶ。空の手で戻る動きは描かない | 運ぶ時間は移動1回分 N = ⌈1024 / min(256, \|回転数\|)⌉ tick。1往復 4N ごとに1回運ぶ |
| `TP-MOTION-DEPOT` | デポ | 入った物は、端から真ん中へ寄る（1 tick に残りの距離の 1/4 ずつ）。上のプレス・デプロイヤーの処理時間だけ止まり、そのあとアームやファンネルが取るまで待つ | 寄るのは約 10 tick。処理は「機械の処理時間」 |
| `TP-MOTION-BELT-MACHINE` | ベルトの上のプレス・デプロイヤー・スパウト | ベルトの区間の真ん中で止まり、処理の時間だけ待って、また進む | 「機械の処理時間」。スパウトは下の「スパウト」 |
| `TP-MOTION-MILLSTONE` | 石臼 | 中に入り、処理時間だけ待つ。できた物は中に溜まり、取り出すブロックで出る | 「機械の処理時間」 |
| `TP-MOTION-CRUSHING` | 粉砕ホイール | 上から落ちて真ん中に入り、処理時間だけ待ち、できた物を下へ放り出す | 「機械の処理時間」 |
| `TP-MOTION-SAW` | ソー（上向き） | 上に載った物が処理時間だけ待ち、できた物を回転の向きへ放り出す（横 1/16、上 1/8 ブロック/tick） | 「機械の処理時間」 |
| `TP-MOTION-BASIN` | ベイスン | 中に溜まり、上のミキサー・プレスの処理時間だけ待ち、出す向きへ移す | 「機械の処理時間」 |

出典：`logistics/funnel/FunnelBlockEntity.java`、`kinetics/belt/transport/BeltFunnelInteractionHandler.java`（`funnelEntry`）、`logistics/chute/ChuteBlockEntity.java`（`getItemMotion`、`getExtractionAmount`）、`logistics/chute/SmartChuteBlockEntity.java`、`logistics/depot/DepotBehaviour.java`、`kinetics/crusher/CrushingWheelControllerBlockEntity.java`、`kinetics/saw/SawBlockEntity.java`（出す動き）

### 足すブロック

#233 で「物の通り道」に足したもの（扇風機・メカニカルクラフターは #235）。通り道の規則（受け取る・先へ送る）と、動きを合わせて書く。「計算では」は、ゲームの動きを一定の流れに直すときの決めごと。

#### 重さ付きイジェクター（`create:weighted_ejector`）

`TP-EJECTOR`

- 受け取る：デポと同じく、どの面からでも。ただし投げる準備ができている（ばねを巻き終えた）間だけ。
- 投げる先：`facing`（水平。ゲームの `HORIZONTAL_FACING` の名前は facing）の向きに `HorizontalDistance` ブロック（0 なら 1）、上に `VerticalDistance` ブロックのマス（どちらも生データ）。そのマスのブロックが受け取るなら渡し、受け取らなければそこに放り出す。間にブロックがあれば、当たった所に落ちる（この版では見ない）。
- 投げる時：載った物が真ん中まで寄り、数が生データの `ScrollValue`（1回に投げる数。0 なら数を問わない）に届いたとき。止まっていると投げない。
- 道の形：放物線。飛ぶ時間 T は、距離 h（横）と v（縦）から次で出す（`EntityLauncher`）。
  - yPeak = max(0, v + (h + 0.5) / 8) + (h ≤ 1 なら 1、それ以外は 4)
  - yMotion = √(2 yPeak / 13) + 0.015 yPeak
  - tPeak = ln(98 / (25 yMotion + 98)) / (2 ln 7 − 2 ln 5 − ln 2)
  - T = max(3, √(yPeak − yMotion) × 4.87 + 0.115 (yPeak − yMotion) + tPeak) tick
  - 途中の位置は、横が x(t) = −10.6033 xMotion (0.91ᵗ − 1)、縦が y(t) = −49.4983 yMotion × 0.98ᵗ + 49.4983 yMotion − 194.033 × 0.98ᵗ − 3.92 t + 194.033。xMotion は t = T で横の距離 h になる値。
- 次に投げられるまで：投げたあと、ふたが開き切るのに数 tick（約 4 tick）、そのあとばねを巻く。巻くのは 1 tick に (|回転数| / 256) / √(h² + v²) ずつ（h = v = 0 なら |回転数| / 256）で、1 から 0 まで。巻く時間は ⌈256 √(h² + v²) / |回転数|⌉ tick。
- 輸送量の上限：1回の数 ÷ （巻く時間 + 約 4 tick）。
- 計算では：生データに距離がなければ、横 1 ブロック先へ投げるとして仮定に載せる。投げる先のマスが空気なら、そこから下（3段まで）に落ちる。1回に投げる数と、輸送量の上限は物の通り道に入れない（ほかの運ぶブロックと同じ）。
- 出典：`logistics/depot/EjectorBlockEntity.java`（`getWindUpSpeed`、`tick`）、`logistics/depot/EntityLauncher.java`

#### 安山岩のトンネル（`create:andesite_tunnel`）

`TP-ANDESITE-TUNNEL`

- ベルトの水平の区間の1段上に置く。区間を通る物はそのまま進む。
- 2個以上の山がトンネルの区間に入るとき、左右の開いた口（トンネルの横に、受け取るベルトなどがある側）へ1個ずつ分ける。残りは先へ進む。1個ずつの物は分けない。
- 一定の流れとしては、入る山の数 × 1個ずつが左右へ、残りが先へ。1個ずつ流れるときは何も分けない。
- 動き：分けた物は、その場で横のベルトに移る（時間 0）。
- 計算では：物の入口の物は1個ずつ流れるとするので、横へは分けずに素通りする。横に口（ブロック）があれば、そのことを仮定に載せる。
- 出典：`kinetics/belt/transport/BeltTunnelInteractionHandler.java`（`flapTunnelsAndCheckIfStuck`）

#### 真鍮のトンネル（`create:brass_tunnel`）

`TP-BRASS-TUNNEL`

- ベルトの水平の区間の1段上に置く。横に並んでつながった真鍮のトンネルは、まとめて1つの分け先の組になる。
- 入った山をいったん預かり、`brassTunnelTimer`（10 tick）ごとに、組の出口（各トンネルの先のベルトと、横の開いた口）へ分ける。
- 分け方は生データの `ScrollValue`：0 分ける、1 必ず分ける、2 順番、3 必ず順番、4 近い方、5 ランダム、6 そろえる。一定の流れとしては、4 は受け取れる限り一番近い出口へ全部、ほかは出口の数で等しく分ける。
- 動き：トンネルの区間で 10 tick 待ってから、それぞれの出口のベルトに移る。
- 分けるのは、ベルトの軸と違う向きの口（生データの `Flaps`）があるか、横のトンネルとつながっている（`ConnectedLeft`・`ConnectedRight`）ときだけ。そうでなければ預からずに、物はそのまま先へ進む（`hasDistributionBehaviour`）。
- 出口にするのは、口（生データの `Sides`）にある向きだけ。入ってきた向きには戻さない（`addValidOutputsOf`）。
- 計算では：組は、横（ベルトに直角）に並んだ、上に真鍮のトンネルがある同じ軸の水平のベルト（8 つまで）。出口は、各トンネルの区間の次の区間（ベルトの端なら端の先）と、組の両端のトンネルの区間の横のマスにあるブロック。生データに `Sides` があれば、その向きにない出口は使わない。`Flaps`・`Sides` がなければ、ブロックがあれば口とする（#253 より前と同じ）。
- 出典：`logistics/tunnel/BrassTunnelBlockEntity.java`（`SelectionMode`、`distributionProgress`、`hasDistributionBehaviour`、`addValidOutputsOf`）、設定の `logistics.brassTunnelTimer`

`TP-BRASS-TUNNEL-FILTER`

- 面ごとにフィルター（生データの `Filters` の、`Side` と `Filter`。`Side` は 2 北・3 南・4 西・5 東）を付けられる。中身は `TP-FILTER` と同じ読み方。
- 入る側（ベルトが進んできた側）のフィルターに合わない物は、トンネルに入れず、手前の区間の端で止まる（`BeltTunnelInteractionHandler.stuckAtTunnel`、`canInsert`）。分けないトンネルでも同じ。
- 出る側のフィルターに合わない物は、その出口に分けない（`testFlapFilter`）。
- 計算では：止まった物は、手前の区間を `TAKE` の点にする機械アームがあれば全部取られ（`TP-BLOCK-ARM-BELT`）、なければそこで止まる。面にフィルターがないとき、隣のブロックのフィルターを使う決まり（`testFlapFilter`）は扱わない。

#### ホッパー（`minecraft:hopper`）

`TP-HOPPER`

- 受け取る：上の入れ物から吸い込む。上から落ちてきた物も入る。
- 先へ送る：`facing`（下か横）の先の入れ物へ。`enabled=false` なら止まる。
- 速さ：8 tick ごとに1個（2.5 個/秒）。中は入れ物として描かない。
- 計算では：上の入れ物（取り出すファンネル・機械アームと同じく、入れ物から先へ出す先の1つ）から吸い込む。届いた物は 8 tick 止まってから先へ。先がなければ、ただの入れ物。届く数が 2.5 個/秒を超えたら、プローブに出す。
- Minecraft の動きなので、Create のソースではない。

#### 扇風機（`create:encased_fan`）

`TP-FAN`

- 風の通り道は、扇風機の `facing` の側のマス（1 マス先から、届く距離まで）。押すときも引くときも同じマスで、風の向きだけが変わる。
- 風の向きは、回転数を `facing` の向きの符号に直した値（`facing` が east・up・south ならそのまま、west・down・north なら符号を逆に）が正なら `facing` の向き（押す）、負なら逆（引く）（`EncasedFanBlockEntity.getAirFlowDirection`、`convertToDirection`）。回転数が 0 なら風はない。
- 風の届く距離は lerp(min(|回転数| / 256, 1), 3, 20) ブロック（`fanPushDistance`・`fanPullDistance` の初期値 20、`fanRotationArgmax` の初期値 256）。1 マス先から順に見て、風を止めるブロックがあればそこまで（`AirCurrent.getFlowLimit`）：
  - 扇風機を通すブロック（タグ `create:fan_transparent`：ブレイズバーナー、帆の枠、鉄格子、柵、葉、焚き火など）と、当たり判定のないブロック（空気・水・溶岩・火）は通す。
  - 当たり判定が1ブロック全部なら、そのマスの手前で止まる。
  - 一部だけの形なら、風の向きに5本の線（面の (0.25, 0.25)・(0.25, 0.75)・(0.5, 0.5)・(0.75, 0.25)・(0.75, 0.75)）を通し、どれかが抜ければ通す。どれも当たれば、そのマスの中で止まる（そのマスまでは届く）。
  - 計算では、上の2つ目と3つ目を次の表で決める。表にないブロックは、1ブロック全部の形として手前で止める。

    | ブロック | 計算では |
    | --- | --- |
    | 上向き・下向きのファンネル（`create:andesite_funnel`・`brass_funnel`）で、風が水平 | 線が抜けるので通す（上向きは高さ −2/16〜8/16、下向きは 8/16〜18/16 の形） |
    | ほかのファンネル、ベルト（`create:belt`）、デポ（`create:depot`） | そのマスまで届いて止まる（ベルトの平らな所は 1〜15 × 3/16〜13/16、デポは高さ 13/16 の箱で、5本とも当たる） |

- 風の中の放り出した物は、風の向きへ押される。目標の速さは |回転数| / 512 ÷ （扇風機からの距離 / 届く距離）ブロック/tick で、1 tick に差の 1/8 ずつ近づく。
- シュートにつながった扇風機は、シュートの中の物の速さを変える（上の「シュート」）。
- 出典：`kinetics/fan/AirCurrent.java`（`rebuild`・`getFlowLimit`・`findMaxDepth`）、`kinetics/fan/IAirCurrentSource.java`（`getMaxDistance`）、`kinetics/fan/EncasedFanBlockEntity.java`、`kinetics/base/KineticBlockEntity.java`（`convertToDirection`）。0.5.1 と 6.0 で同じ。

`TP-FAN-CATALYST` 風の通り道の処理の種類（`AirCurrent.rebuild`、`FanProcessingType.getAt`）：

- 風の通り道のマスごとに、次の順で最初に当てはまる種類を見る（優先度の高い順）。

  | 種類 | そのマスにあるもの |
  | --- | --- |
  | 洗う（splashing） | 水（水源・流れる水、`waterlogged=true` のブロックも） |
  | 憑依（haunting） | ソウルファイア、火のついたソウル焚き火（`lit=true`）、ソウルの火のついたブレイズバーナー（`create:lit_blaze_burner` の `flame_type=soul`） |
  | 燻す（smoking） | 火、火のついた焚き火、ふつうの火のついたブレイズバーナー（`lit_blaze_burner` の `flame_type=regular`）、ブレイズバーナーの `blaze=smouldering` |
  | 焼く（blasting） | 溶岩（水源・流れる溶岩）、ブレイズバーナーの `blaze` が `fading`・`kindled`・`seething` |

- 種類は、見つけたマスから風の進む向きに、次の種類が見つかるまで続く。押す風なら見つけたマスとその先（扇風機から遠い方）、引く風なら見つけたマスとその手前（扇風機に近い方）。どの種類もなければ、何もしない風。
- 種類を決めるタグ（`create:fan_processing_catalysts/…`）は、Create の jar の中身（0.5.1。ブロックのタグとして、焼く：`blaze_burner`、燻す：`blaze_burner`・`lit_blaze_burner`・`fire`・`campfire`、憑依：`lit_blaze_burner`・`soul_fire`・`soul_campfire`。液体のタグとして、焼く：溶岩、洗う：水）。Modpack がタグを変えていても、この表を使う。

`TP-FAN-RECIPE` できる物（`AllFanProcessingTypes` の `process`）：

| 種類 | 使うレシピ | レシピがないとき |
| --- | --- | --- |
| 洗う | `create:splashing` | 変わらない |
| 憑依 | `create:haunting` | 変わらない |
| 燻す | `minecraft:smoking` | 変わらない |
| 焼く | `minecraft:smelting`、なければ `minecraft:blasting`。ただし同じ物の `minecraft:smoking` のレシピが同じ物を作るなら（食べ物）、焼けて**なくなる** | 燃えない物（ネザライトなど）でなければ、焼けて**なくなる**。計算では燃えない物か分からないので、なくなるとして仮定に載せる |

- かかる時間は `fanProcessingTime`（150）× (⌊(個数 − 1) / 16⌋ + 1) + 1 tick。計算では1個ずつ（151 tick）とする。
- 風の中の物は全部同時に処理するので、扇風機は律速の機械にしない（処理できる数を持たない）。
- 出典：`kinetics/fan/processing/AllFanProcessingTypes.java`、`FanProcessing.java`。0.5.1 と 6.0 で同じ（6.0 は燃えない物を `DataComponents.FIRE_RESISTANT` で見る）。

`TP-FAN-ON-BELT` 風の中のベルト・デポ（`AirCurrent.findAffectedHandlers`、`FanProcessing.applyProcessing(TransportedItemStack…)`）：

- 風の通り道のマスと、風が水平ならその1段下のマスにあるベルト・デポの上の物を処理する。種類はそのブロック自身の種類（上の表。ふつうはない）、なければそのマスの風の種類。
- デポ：置いた物は処理が終わるまで（151 tick）とどまり、できた物が先へ進む。
- ベルト：物は止まらずに進み、風の中を続けて通る区間にいた時間が 151 tick に届いたら、その区間でできる物に変わって先へ進む。届かなければ変わらずに通り過ぎ、プローブに出す。区間1つの時間は 1 ÷ ベルトの速さ（秒）。

`TP-FAN-DROPPED` 風の中に放り出した物（`AirCurrent.tickAffectedEntities`、`FanProcessing.applyProcessing(ItemEntity…)`）：

- 落ちた物（取り出すファンネル・シュートの先・ベルトの端など、空気に出した物）が、受け取るブロックに断られて（フィルターに合わないファンネルなど）そこにとどまり、そのマスかその1つ上のマスが風の通り道なら、処理してから、できた物をもう一度同じブロックに渡す。受け取られたら先へ、また断られたらそこに溜まる。
- 受け取るブロックがそのまま受け取る物は、処理されない（ファンネルは触れた物をすぐ吸い込む）。
- 計算では、風が物を押し流す動き（上の目標の速さ）はたどらず、物は落ちた所にとどまるとする。

- 計算では：扇風機のブロックそのものに物が届いたら、今までどおり止めて仮定に載せる。

#### スパウト（`create:spout`）

`TP-SPOUT`

- プレスと同じく、2段下のベルトの区間の真ん中か、デポの物に液体を入れる。間の1段に当たり判定のあるブロックがあれば入れない。
- 動き：液体を入れられる物なら、真ん中で 20 tick（`FILLING_TIME`）止まり、できた物になって進む。入れられない物は止まらずに通る（`onItemReceived` が `PASS`）。
- できる物（`FillingBySpout.fillItem`）：
  1. 材料の物と、スパウトの液体に合う `create:filling` のレシピ。2つ以上あれば ID の名前順で最初のもの（仮定に載せる）。
  2. なければ、Create の決まり（`GenericItemFilling`）：バケツ（`minecraft:bucket`）は液体のバケツ（水 → `water_bucket`、溶岩 → `lava_bucket`、ほかは `<液体の namespace>:<液体の名前>_bucket` として仮定に載せる）。ガラス瓶（`minecraft:glass_bottle`）に水なら `minecraft:potion`（水入り瓶）。
  3. どれでもなければ、物は変わらずに通る。
- 液体のタグは、`minecraft:water`・`minecraft:lava` は水・溶岩（流れるものも）。ほかのタグは、タグの名前の最後（`c:honey` の `honey`）が液体の名前と同じなら合うとする（液体のタグのファイルは読まない）。
- `TP-SPOUT-FLUID` スパウトの液体（計算では）：
  1. 生データのタンク（1.18 は `Tanks[0].TankContent.FluidName`、1.21 は `Tanks[0].TankContent.id`）が空でなければ、その液体。
  2. 空なら、スパウトの上と横につながった液体の管（`create:fluid_pipe`・`encased_fluid_pipe` はつながる面のプロパティ、`glass_fluid_pipe` は `axis`、`mechanical_pump`・`fluid_valve` は `facing` の軸）をたどり、管の口の先にある液体の出どころを集める。出どころは、液体の水源（`level=0` の水・溶岩、`waterlogged=true` のブロックは水）、水・溶岩の入った大釜、空の大釜で上の鍾乳石（`pointed_dripstone`、下向き）の根もとの1つ上のブロックの、さらに上が水・溶岩の水源のもの（鍾乳石が大釜に垂らす液体）、生データのタンクに液体のある Create のブロック（液体タンク・スパウト・ドレイン・ベイスン）。ポンプの向きは見ない。
  3. 見つかった液体が1つならそれを使い、2つ以上なら名前順で最初のものを使う。どちらも、管からたどったことを仮定に載せる。見つからなければ、液体が分からないので物は変わらずに通るとして仮定に載せる。
- 出典：`fluids/spout/SpoutBlockEntity.java`（`below(2)`、`onItemReceived`・`whenItemHeld`）、`fluids/spout/FillingBySpout.java`、`fluids/transfer/GenericItemFilling.java`、`kinetics/belt/behaviour/BeltProcessingBehaviour.java`。液体の管のたどり方は、このアプリの決めごと。

#### アイテムドレイン（`create:item_drain`）

`TP-ITEM-DRAIN`

- 受け取る：どの面からでも。上から入れた物は真ん中に置く。液体を抜ける物は1個ずつ受け取り、残りは入れた側に残る。
- 動き：入った面から反対の面へ、1 tick に 1/8 ブロックで通り抜ける。液体を抜ける物なら、真ん中で 20 tick 止まる。
- できる物（`GenericItemEmptying.emptyItem`）：
  1. ポーション（`minecraft:potion`・`splash_potion`・`lingering_potion`）は、ガラス瓶。
  2. 材料に合う `create:emptying` のレシピ。2つ以上あれば ID の名前順で最初のもの（仮定に載せる）。
  3. なければ、液体の入った物：液体のバケツ（ID が `_bucket` で終わるもの。空のバケツと粉雪のバケツ `powder_snow_bucket` を除く）は、空のバケツ（`minecraft:bucket`）。
  4. どれでもなければ、物は変わらず、止まらずに通り抜ける。
- 抜いた液体はドレインのタンクに入り、管で運ばれる。計算では液体の行き先はたどらない（「この版で扱わないもの」の液体の流量）。
- 先へ送る：反対の面の先のブロックが受け取るなら渡し、受け取らなければ放り出す。
- 計算では：上からと、入れ物として入れた物（機械アーム・ファンネル）は、ドレインに置かれ、取り出すファンネル・機械アームで先へ。
- 出典：`fluids/drain/ItemDrainBlockEntity.java`（`itemMovementPerTick`、`FILLING_TIME`）、`fluids/transfer/GenericItemEmptying.java`

#### メカニカルクラフター（`create:mechanical_crafter`）

`TP-CRAFTER`

- 受け取る：どの面からでも、入れ物として（ファンネル・機械アーム・ベルトの端など）。1台に入るのは1個。スロットカバーを付けたクラフター（生データの `Cover` が真）には入らない。
- 速さ s = |回転数| を 4〜250 に収めた値。止まっていれば組み立てない。
- すべてのクラフター（カバーの付いたものは除く）に材料が入ると、組み立てを始める。
- 段階ごとに、残りの数から毎 tick s を引き、0 より小さくなったら次の段階へ進む（数値 n の段階は ⌊n / s⌋ + 1 tick）。
  - 組み立て（`ASSEMBLING`）：1（Create 6.0。0.5.1 は 500、2台目からは max(100, s + 1)）。
  - 次のクラフターへ渡す（`EXPORTING`）：1000。前のクラフターがすべて渡し終えると、次のクラフターの組み立てが始まる。
  - 最後の1台で作る（`CRAFTING`）：2000。
- 1回にかかる時間は、矢印をたどって最後の1台までの、一番長い道の段階の合計。
- `TP-CRAFTER-GRID` クラフターの組（`RecipeGridHandler`）：
  - 矢印の向き（`facing` と `pointing` から決まる）の隣が、同じ `facing` のクラフターなら、そこへ渡す。2台の `pointing` が逆向き（上と下、左と右）なら渡さない。
  - 矢印の向き：`pointing=up` は上、`down` は下、`left` は `facing` を時計回りに回した向き、`right` は反時計回りに回した向き（`MechanicalCrafterBlock.getTargetDirection`）。
  - 組は、渡す・渡されるでつながったクラフターすべて。矢印の先がクラフターでない1台が、最後の1台。
  - 材料の並びは、最後の1台から見た位置。上が上、横は `facing` を反時計回りに回した向きが右（`GroupedItems.mergeOnto`）。
  - 入力をつないだクラフター（生データの `ConnectedInput`。`Controller` が偽なら、`Data` の1つ目がまとめ役への相対位置。まとめ役の `Data` がつないだクラフターの相対位置）は、どれに入れても、まとめ役の組の空いたクラフターに、上の段から順に1個ずつ入る（`ConnectedInputHandler`）。
- `TP-CRAFTER-RECIPE` できる物（`RecipeGridHandler.tryToApplyRecipe`）：
  1. 作業台のレシピ（`crafting_shaped`・`crafting_shapeless`）。形のあるものは、並びの空いていない範囲がパターンと同じ（左右を入れ替えたものも）なら合う。形のないものは、入っている材料の数と種類が合えば合う。
  2. なければ `create:mechanical_crafting`（左右の入れ替えは `accept_mirrored` のとき）。
  3. 合うレシピが2つ以上なら ID の名前順で最初のもの（仮定に載せる）。どれもなければ、材料は放り出される。
  4. 容器の残る材料は、できた物と一緒に出る（水・溶岩・牛乳のバケツ → バケツ、ハチミツ入りの瓶・ドラゴンブレス → ガラス瓶）。
- できた物は、最後のクラフターの矢印の先のブロックに入れる（入れ物・ベルトなど）。先が空気なら、最後のクラフターの前（`facing` の側）に放り出す。
- 計算では：
  - 組の材料は、物の入口からたどり終えてから、組ごとにまとめて処理する（組のすべてのクラフターへの材料がそろってから組み立てるため）。処理したあとに組に届いた物は、組み立てに入れない（仮定に載せる）。
  - 1台に届く物が1種類なら、並びは決まる。入力をつないだ組に2種類以上が届くときは、並びが分からないので、材料の数と種類だけで合うレシピを探し、仮定に載せる。
  - 1秒に作る数は、材料ごとの「届く数 ÷ 1回に使う数」の一番小さいものと、1回にかかる時間で作れる数の小さい方。速さは組のうち一番遅いクラフターのもの。使われない材料は、クラフターの前で詰まる（メモに書く）。
  - 材料が届かないクラフター（カバーのないもの）があれば、組み立てない（仮定に載せる）。
  - 律速の機械には入れない（届く物と作る物の数え方が違うため）。
- 出典：`kinetics/crafter/MechanicalCrafterBlockEntity.java`（`Phase`、`getCountDownSpeed`、`tryInsert`、`eject`）、`RecipeGridHandler.java`、`ConnectedInputHandler.java`、`MechanicalCraftingRecipe.java`、`MechanicalCraftingInput.java`

#### この版で扱わないもの

- チェーンコンベア・パッケージャー・フロッグポート（Create 6.0 だけにある）。
- 動く仕掛け（Contraption）と、ポータブルストレージインターフェース。
- イジェクターの飛ぶ道の途中のブロックとの当たり、扇風機の風の正確な形（ブロックの形による短い風）。

## 律速（#168）

物の入口を置いたとき、「入る数 → 各機械の処理量 → 出る数」を並べ、一番遅い所（律速）に印を付ける。物の通り道（上の節）でたどった結果を使う。

### 決め方

- `TP-BOTTLENECK-USAGE` 機械ごとの使用率 = 届く数 ÷ 処理できる数（どちらも 個/分）。処理できる数は「機械の処理時間」の1分あたりの数で、物の通り道で使ったレシピで計算する。
- `TP-BOTTLENECK-CHOOSE` 使用率が一番高い機械を律速とする。同じなら、先にたどった方（物の入口に近い方）。
- `TP-BOTTLENECK-IO` 入る数は、たどった物の入口の数の合計。出る数は、溜まる所（先がない入れ物）に届く数の合計。物の種類は分けずに足す。
- `TP-BOTTLENECK-HEADROOM` 律速の使用率が 100% 以下なら、入る数を「入る数 ÷ 使用率」まで増やせる（どの機械も、届く数は入る数に比例するため）。
- `TP-BOTTLENECK-OVER` 100% を超えたら、律速の機械は追いつかない（計算の問題「処理が追いつかない」も出る）。そのとき下流の機械に届く数は、上流で処理できた分だけになる。2つ以上の機械が追いつかないときは、入る数を減らしたときの律速が変わることがあるので、増やせる数・減らす数は出さない。
- `TP-BOTTLENECK-MACHINES` 処理できる数が決まるのは、レシピで処理した機械（石臼・粉砕ホイール・ソー・ミキサー・プレス）だけ。運ぶブロック（ベルト・機械アーム・ファンネル）は、1回に運ぶ山の大きさで輸送量が大きく変わるので、この版では律速に入れない。
- `TP-BOTTLENECK-NO-PACK` Modpack がなく、レシピが分からない機械は、プローブの「処理時間」と同じく Create の初期値の処理時間（「どのレシピか」の 5）で処理できる数を出し、律速に入れる。出どころは仮定になる。機械でできる物は分からないので出る数に入らず、まとめの行にそう書く。
- `TP-BOTTLENECK-NONE` 処理する機械が1つもなければ、律速は出さず、入る数と出る数だけを出す。

### 出すもの

- `TP-BOTTLENECK-OUTPUT` 計算結果のまとめの「生産ライン」の行。入る数・律速の機械と使用率・出る数・増やせる数。行を押すと律速の機械へ移る。
- `TP-BOTTLENECK-OUTPUT` 律速の機械のプローブに「律速」の値（使用率）。
- 出どころは、物の通り道でたどった値（届く物・レシピ・溜まる物）の一番弱いもの。

### 例（テスト）

小麦（石臼のレシピの処理時間 150。できる物は小麦粉 1 + 2 × 0.25 = 1.5 個と種 0.25 個）を、石臼に 1 個/秒（60 個/分）入れ、できる物はデポに溜まる。

| 石臼の回転数 | 処理できる数 | 使用率 | 出る数 | まとめの行 |
| --- | --- | --- | --- | --- |
| 256 RPM | ⌈150 / 16⌉ = 10 tick で1個。120 個/分 | 50% | 60 × 1.75 = 105 個/分 | 入る 60 個/分 → 律速 石臼 120 個/分のうち 60 個/分（50%） → 出る 105 個/分。入る数は 120 個/分まで増やせる |
| 16 RPM | 150 tick で1個。8 個/分 | 750% | 8 × 1.75 = 14 個/分 | 入る 60 個/分 → 律速 石臼 8 個/分のうち 60 個/分（750%、追いつかない） → 出る 14 個/分 |

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
| いずれかの材料 | 配列 | 配列か `{ type: "neoforge:compound", ingredients }` |

ベルト・ファンネル・シュート・プレス・石臼・ソー・デプロイヤーの規則と、`defaultExtractionTimer`・`bulkPressing` の初期値は同じ。

## この版で扱わないもの

- 物の入口を置かないときの、設計図全体の流れ。
- 運ぶブロック（ベルト・機械アーム・ファンネル）の輸送量で決まる律速（上の「律速（#168）」）。
- シュートの扇風機の風と、扇風機の風が物を押し流す動き。規則は「物の動き（#233）」の「扇風機」に書いた。扇風機の処理は #235 で計算に入れた。
- チェーンコンベアとパッケージ（Create 6.0 だけにある）。
- 液体（ポンプ・パイプ）の流量。
- ワールドのデータパックのレシピ。
- KubeJS のスクリプトのうち、上の「KubeJS のスクリプトのレシピ」の表にない呼び出しで作るレシピ（`forEachRecipe` でほかの種類から作るもの、Java のクラスを使うものなど）。
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
- 作り物の KubeJS で集めたレシピが、ゲームの中のレシピ（JEI などで見えるもの）と同じになるか（Create Astral で数を比べる）。
- イジェクターが投げてから次に受け取れるまでの、ふたの動きの tick 数（約 4 tick とした。ゲームで計る）。
- メカニカルクラフターの組み立てを始める時間。Create 6.0 の 1 を使う（0.5.1 の 500 と max(100, s + 1) のどちらになるかは、クラフターの並び方による）。
- 扇風機の風の中の物の速さ（式は読んだが、物の摩擦との組み合わせで実際の速さが変わる。ゲームで計る）。

## 参照したソース

上の各節の「出典」。Fabricators-of-Create/create の commit `80ecefb` と、Creators-of-Create/Create の commit `7ff2760`。パスはどちらも同じ。
