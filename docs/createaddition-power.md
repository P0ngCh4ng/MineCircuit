# Create Crafts & Additions の電力計算の仕様

作成日: 2026-11-28 / Issue: #276 / 設計: [design.md](design.md)「Mod ごとのものを足す口」

Create Crafts & Additions（namespace `createaddition`。以下 C&A）の電力（FE）と、Create の回転とのやりとりの規則を、C&A の jar から読み取ってまとめる。2つ目の計算プラグイン（spec.md「開発の順番」7）の仕様。コードは写さず、規則だけを書く。

## 対象のバージョンと出典

| 環境 | Minecraft | C&A | 読んだもの |
| --- | --- | --- | --- |
| ATM10 | NeoForge 1.21.1 | 1.7.2 | 手元の ATM10 の `mods/createaddition-1.7.2.jar`（`META-INF/neoforge.mods.toml` の `version = "1.7.2"`） |
| Create Astral | Fabric 1.18.2 | 20230704a | 手元の Create Astral の `mods/createaddition-fabric-1.18.2-20230704a.jar`（`fabric.mod.json` の `version`） |

- どちらも jar のクラスファイルを `javap -c` で読み、定数と分岐を確かめた（2026-11-28）。ソースのリポジトリ（[mrh0/createaddition](https://github.com/mrh0/createaddition)）は取得していない。
- C&A のコードは MIT License（`neoforge.mods.toml`・`fabric.mod.json` の `license`）。数値はコードの中の定数なので、README の注記に出典を書いて内蔵する。テクスチャ・モデルなどの assets は使わない。
- 以下、クラス名は `com/mrh0/createaddition/` からの相対で書く。1.7.2 のクラス名（`…BlockEntity`）で書き、Fabric 版（`…TileEntity`）で違うところは「バージョンの違い」に書く。

**規則 ID。** 規則ごとに `CA-` で始まる ID を付ける。テストの名前に `[CA-…]` の形で入れる。Create の規則の一覧（`tests/verification/rules.ts`）にはまだ入れていない（「まだ扱わないもの」）。

## 単位

- **電力**：FE/t（1 tick あたりの Forge Energy。Fabric 版は Team Reborn Energy の E/t だが、数は同じ）。1 秒は 20 tick。
- **蓄えた電気**：FE。
- **回転数・応力**：Create と同じ（docs/create-stress.md「単位と符号」）。

## 値の出どころ

design.md の「値の出どころ」に当てはめる。

| 値 | ① | ② | ③ |
| --- | --- | --- | --- |
| 変換の割合・上限など（Mod の定数） | Modpack の `createaddition-common.toml` | — | 内蔵の初期値（下の表） |
| モーターの回転数（個体の設定値） | 設計図の nbt（`ScrollValue`） | — | 内蔵の初期値（32 RPM） |
| 発電機の回転数 | 先に走った回転の計算の結果（Create の応力） | — | 0（回っていない） |
| 電線のつながり（構造） | 設計図の nbt（接続の `nodes`） | — | — |

`CA-CONFIG-SEARCH` 設定ファイルは **共通設定**（common）で、ワールドごとではない。探す順番：

1. `config/createaddition-common.toml`
2. なければ `defaultconfigs/createaddition-common.toml`
3. なければ内蔵の初期値を使い、仮定に載せる

`CA-PROFILE` **版の見分け。** 規則と初期値は版で違うものがある（下の「バージョンの違い」）。Modpack からは C&A の版が分からないので、設計図の Minecraft の版（DataVersion）で選ぶ。2975（1.18.2）以下なら Fabric 1.18.2 版、それより新しければ 1.7.2 とみなし、どちらを選んだかを仮定に載せる。手元の2つの Modpack（Create Astral・ATM10）はこれで正しく分かれる。ほかの版（Forge の 1.18.2〜1.20.1 など）は確かめていない。設定ファイルにある項目は、版によらずその値を使う（Fabric 版の項目名 `connector_max_input`・`wire_length` も読む）。

## 数値の表

設定ファイルの表 `[…]` と項目名。どの版も1つのファイルに入る。

| 項目 | 表・項目名 | 1.7.2 | Fabric 1.18.2 |
| --- | --- | --- | --- |
| 256 RPM のときの電力 | `general.fe_at_max_rpm` | 480 | 480 |
| モーター・発電機の 256 RPM のときの応力 | `general.max_stress` | 16384 | 16384 |
| モーターの回転数の上限 | `electric_motor.motor_rpm_range` | 256 | 256 |
| モーターの最小の消費 | `electric_motor.motor_min_consumption` | 8 | 8 |
| モーターが受け取れる量 | `electric_motor.motor_max_input` | 5000 | 5000 |
| モーターの中の蓄え | `electric_motor.motor_capacity` | 5000 | 5000 |
| 発電機が出せる量 | `alternator.generator_max_output` | 5000 | 5000 |
| 発電機の効率 | `alternator.generator_efficiency` | 0.75 | 0.75 |
| 圧延機の応力（SU/RPM） | `rolling_mill.rolling_mill_stress` | 8 | 16 |
| 小さい接続の入出力の上限 | `wires.small_connector_max_input`・`_max_output`（Fabric は `connector_max_input`・`_max_output`） | 1000 | 5000 |
| 小さい接続の電線の長さの上限 | `wires.small_connector_wire_length`（Fabric は `wire_length`） | 16 | 12 |
| 大きい接続の入出力の上限 | `wires.large_connector_max_input`・`_max_output` | 5000 | （ない） |
| 大きい接続の電線の長さの上限 | `wires.large_connector_wire_length` | 32 | （ない） |
| 明かり付きの接続の消費 | `wires.small_light_connector_consumption` | 1 | （ない） |
| 蓄電池の1ブロックの容量（FE） | `accumulator.accumulator_capacity` | 2,000,000 | 2,000,000 |
| 蓄電池の入出力の上限 | `accumulator.accumulator_max_input`・`_max_output` | 5000 | 5000 |

## ブロック

計算で扱うブロック。プロパティは、ゲームが保存する全部（`createBlockStateDefinition`）。

| ブロック | ID | プロパティ | 役目 |
| --- | --- | --- | --- |
| 電気モーター | `electric_motor` | `facing`（6向き）・`powered` | 電気で回す動力源 |
| 発電機（オルタネーター） | `alternator` | `facing`（6向き） | 回転で電気を作る |
| 圧延機 | `rolling_mill` | `facing`（水平4向き） | 回転を使う機械（電気は使わない） |
| 接続（小さい） | `connector` | `facing`・`mode`（`none`・`push`・`pull`）・`rotation`・`variant`（`default`・`girder`）。Fabric は `facing`・`mode` だけ | 電線の端 |
| 大きい接続 | `large_connector` | 小さい接続と同じ（1.7.2 だけ） | 電線の端 |
| 明かり付きの接続 | `small_light_connector` | 小さい接続と同じに `powered`（1.7.2 だけ） | 電線の端。明かりに電気を使う |
| 蓄電池 | `modular_accumulator` | `top`・`bottom` | 電気を蓄える。積んでつなげられる |
| 蓄電池（古い形） | `accumulator` | `facing`（水平4向き） | 電気を蓄える（Fabric 版の古いブロック） |
| クリエイティブの電源 | `creative_energy` | なし | いくらでも電気を出す |

`rotation` は NodeRotation の名前の小文字（`none`・`y_clockwise_90` など）。仕掛け（コントラプション）で動かしたときに、電線の向きを直すのに使う。

上の表にない C&A のブロック（テスラコイル・電動ポンプ・携帯電力インターフェースなど）は、電気の出入りを計算に入れず、仮定に載せる（`CA-UNKNOWN-BLOCK`）。

## Create の回転とのやりとり

モーター・発電機・圧延機は Create の回転のネットワークに入る。計算は Create の応力のプラグイン（docs/create-stress.md）が行い、C&A のブロックの形と値は、C&A のプラグインが「Create のアドオンの表」（design.md「Mod ごとのものを足す口」）で渡す。

| 規則 | ブロック | 回転軸 | 軸の口 | 値 |
| --- | --- | --- | --- | --- |
| `CA-KIN-MOTOR` | 電気モーター | `facing` の軸 | `facing` の面だけ | 動力源。生む回転数は下、容量は `max_stress / 256` = 64 SU/RPM |
| `CA-KIN-ALTERNATOR` | 発電機 | `facing` の軸 | 1.7.2 は軸の両側、Fabric は `facing` の面だけ | 消費 `max_stress / 256` = 64 SU/RPM |
| `CA-KIN-ROLLING-MILL` | 圧延機 | `facing` の軸 | 軸の両側 | 消費 `rolling_mill_stress`（1.7.2 は 8、Fabric は 16 SU/RPM） |

- `CA-MOTOR-SPEED` **モーターの回転数。** 生データの `ScrollValue`（−256〜256）。なければ 32。符号は Create のクリエイティブモーターと同じで、`facing` が軸の負の向き（`down`・`north`・`west`）なら逆にする（`GeneratingKineticBlockEntity.convertToDirection`）。
- `CA-MOTOR-ACTIVE` **モーターが回るか。** ゲームは、止まっているモーターに `2 × 消費` より多くの電気が溜まり、`powered` が false なら回し始める。回っている間は毎 tick 消費の分を使い、足りないか `powered` が true になると止まる（`ElectricMotorBlockEntity.tick`）。計算では：
  - 保存された状態（`saved`）：生データの `active` が true なら回っている。`active` がなければ回っているとみなし、仮定に載せる。
  - 動かしたとき（`running`）：`powered` が false なら回っているとみなす。電気が足りるかは、下の電力の計算で調べ、足りなければ問題に出す（`CA-NET-SHORTAGE`）。回転の計算はやり直さない（2つの計算を1回ずつ走らせる。「計算の手順」）。
- 発電機と圧延機は、Create の機械と同じく、ネットワークの回転数で応力を数える。

## 電力の規則

### 作る量と使う量

- `CA-ALT-OUTPUT` **発電機の作る量。** `floor(fe_at_max_rpm × |回転数| / 256 × generator_efficiency)` FE/t。回転数は整数に切り捨ててから使う（`AlternatorBlockEntity.getEnergyProductionRate`）。回っていない・過負荷で止まっているなら 0。初期値で 256 RPM なら 360 FE/t、32 RPM なら 45 FE/t。
- `CA-MOTOR-USE` **モーターの使う量。** `max(fe_at_max_rpm × |設定の回転数| / 256, motor_min_consumption)` を整数に切り捨てた FE/t（`ElectricMotorBlockEntity.getEnergyConsumptionRate`）。ネットワークの回転数ではなく、モーターの設定の回転数で決まる。初期値で 32 RPM なら 60 FE/t、256 RPM なら 480 FE/t、4 RPM なら 8 FE/t。回っていなければ 0。
- `CA-LIGHT-USE` **明かり付きの接続。** `small_light_connector_consumption`（1 FE/t）。
- `CA-CREATIVE` **クリエイティブの電源。** いくらでも出す。

### 電気の通り道

- `CA-ADJ-OUTPUT` **隣へ出す。** 発電機とクリエイティブの電源は、6面の隣のブロックのうち電気を受け取れるものへ、毎 tick 出す（`AlternatorBlockEntity.tick`。1つの面あたり `generator_max_output` まで）。計算では、隣のモーター・蓄電池と同じネットワークにし、量の上限は付けない。隣の接続とのやりとりは、接続の向き（`CA-CONNECTOR-MODE`）だけで決める。
- `CA-CONNECTOR-SIDE` **接続が付いているブロック。** 接続は `facing` の向きの隣のブロック（`pos + facing`）と電気をやりとりする（`AbstractConnectorBlockEntity.updateExternalEnergyStorage`）。
- `CA-CONNECTOR-MODE` **接続の向き。** `mode` が `pull` なら付いているブロックから電線へ取り込み（1 tick に入力の上限まで）、`push` なら電線から付いているブロックへ出す（出力の上限まで）。`none` ならやりとりしない（`AbstractConnectorBlockEntity.networkTick`）。
- `CA-WIRE-NODES` **電線。** 接続の生データの `nodes` に、電線1本につき1つの項目がある：`id`（この接続の口の番号）・`other`（相手の口の番号）・`type`（電線の種類。0 銅・1 金・2 エレクトラム・3 飾り）・`x`・`y`・`z`（相手の接続の位置。**この接続からの相対位置**）。相手が設計図の範囲の外なら、その電線は計算に入れず、警告に出す。相手の位置に接続がないときも警告。
- `CA-WIRE-LENGTH` **電線の長さ。** 2つの接続の位置の距離の2乗が、2つの接続の長さの上限の小さいほうの2乗を超える電線は、ゲームでは張れない（`IWireNode.connect` の `LONG`）。設計図にあればエラーに出す。
- `CA-WIRE-LARGE` **大きい接続どうし。** 大きい接続どうしを銅の電線・飾りの電線でつなぐことはできない（`REQUIRES_HIGH_CURRENT`）。設計図にあればエラーに出す。
- `CA-NET-GROUP` **ネットワーク。** 電線でつながった接続と、それらが `pull`・`push` でやりとりするブロック、`CA-ADJ-OUTPUT` でつながったブロックを1つの電力のネットワークにする。積んだ蓄電池は、隣り合う `modular_accumulator` を1つの蓄電池とみなす（生データの `Controller` は見ない。仮定に載せる）。

### ネットワークごとの釣り合い

- `CA-NET-SUPPLY` **入る量。** 発電機の作る量の合計。発電機から接続を通すものは、接続ごとに入力の上限で頭打ちにする。クリエイティブの電源があれば足りるとする。
- `CA-NET-DEMAND` **出る量。** 回っているモーターと明かり付きの接続の使う量の合計。
- `CA-CONNECTOR-LIMIT` **接続の上限。** 1つの接続を通る量が、その接続の上限（入力か出力）を超えるなら、上限までしか通らない。警告に出す。
- `CA-NET-SHORTAGE` **足りない。** 入る量が出る量より少なく、電気を出せる蓄電池（`pull` の接続が付いたもの）がなければ、エラー「電気が足りないので、モーターが止まる」。あれば警告にして、満タンから空になるまでの時間（`容量 / (出る量 − 入る量)` tick を分にしたもの）を添える。
- `CA-NET-SURPLUS` **余る。** 入る量が出る量より多ければ、余りは蓄電池に溜まる。蓄電池がなければ、余りは使われない（発電機の中の蓄えが満ちる）。余りはまとめの行に出し、問題には出さない。
- `CA-MOTOR-NO-POWER` **電気が来ていないモーター。** 回っているとみなしたモーターに、電線から出す接続（`push`）も隣の発電機・電源もなければ警告。つながったネットワークに発電機・電気を出せる蓄電池・電源のどれもないときも警告（足りないエラーにはしない。組み立て途中で出やすいため）。
- `CA-ALT-IDLE` **回っていない発電機。** 回転の計算の結果で回転数が 0 の発電機は警告。

## 計算の手順

1. Create の応力のプラグインが先に走る。モーター・発電機・圧延機は、アドオンの表から回転のネットワークに入る（`CA-KIN-*`）。モーターが回るかは `CA-MOTOR-ACTIVE`。
2. C&A の電力のプラグインが走る。先に走ったプラグインの結果の回転（`CalcResult.rotations`）から、発電機の位置の回転数を引く（design.md「プラグインの順番と、前の結果」）。回転の結果がなければ（Create の計算が走らなかった・失敗した）、発電機は回っていないとみなし、仮定に載せる。
3. 接続と電線からネットワークを作り（`CA-NET-GROUP`）、ネットワークごとに入る量と出る量を数える。
4. 問題・まとめ・プローブを出す。

モーターが電気不足で止まると、その回転で回していた発電機も止まり、さらに電気が減る、という関係は1回の計算では追わない。足りないネットワークは問題に出すので、利用者が直す。

## 結果の形

- まとめ：電力のネットワークごとの行（「電力 1：発電 360 FE/t / 使用 60 FE/t」。ネットワークのタブに出す）と、全体の合計。
- プローブ：発電機（回転数・作る量）、モーター（設定の回転数・使う量・回っているか）、接続（ネットワーク・上限・電線の数）、蓄電池（容量・蓄えた量）。同じネットワークのブロックは同じ `network` の番号にする。
- 問題：上の `CA-` の規則のエラー・警告。

## 生データ（nbt）の項目

| ブロック | 項目 | 型 | 意味 |
| --- | --- | --- | --- |
| 電気モーター | `ScrollValue` | int | 設定の回転数（Create の `ScrollValueBehaviour`） |
| 電気モーター | `active` | byte（真偽） | 回っているか |
| モーター・発電機 | `energy` | int | 中の蓄え（`InternalEnergyStorage`） |
| 接続 | `nodes` | list（compound） | 電線（`CA-WIRE-NODES`） |
| 蓄電池 | `EnergyContent`・`Controller`・`Size`・`Height` | — | 蓄えた量と、積んだ形（計算では蓄えた量だけを見る） |

### 画面で変えられる項目

| ブロック | 項目 | 範囲 | 初期値 |
| --- | --- | --- | --- |
| 電気モーター | 回転数（`ScrollValue`） | −256〜256（`motor_rpm_range`） | 32 |

## 回転・反転

- `CA-TF-NODES` 範囲を回す・反転するときは、接続の `nodes` の相対位置（`x`・`z`）を同じように回す・反転する。相手が範囲の外に出る電線は、行き先が分からないので `unresolved` にする（design.md「範囲の編集」）。
- ブロック状態の `facing` はバニラの規則で回す。`rotation` は変えない（ゲームは `rotation` を、仕掛けで動かしたときに電線の向きを直すのに使う。アプリは生データの位置を直接直すので、`rotation` を足すと二重に回る）。

## バージョンの違い

| 項目 | 1.7.2 | Fabric 1.18.2 |
| --- | --- | --- |
| 接続の種類 | 小さい・大きい・明かり付き | `connector` だけ |
| 接続のプロパティ | `facing`・`mode`・`rotation`・`variant` | `facing`・`mode` |
| 発電機の軸の口 | 軸の両側 | `facing` の面だけ |
| 圧延機の応力 | 8 SU/RPM | 16 SU/RPM |
| 電線の網の中の蓄え | ネットワークごとに 80,000 FE（`connector_network_internal_buffer`）。計算では使わない | なし |
| 小さい接続の上限・電線の長さ | 1000 FE/t・16 | 5000 FE/t・12 |

計算は `CA-PROFILE` で選んだ版の値を使う。

## まだ扱わないもの

- テスラコイル（充電）・電動ポンプ・携帯電力インターフェース・液体のブレイズバーナー：電気の出入りが使い方で変わるので、計算に入れない（`CA-UNKNOWN-BLOCK`）。
- 圧延機のレシピ（`createaddition:rolling`）と処理時間、充電のレシピ（`createaddition:charging`）。
- 電線の描画、電線を張る道具（つなぐツール）。
- モーター・発電機の回る部品のモデル（部品のモデルの表）。
- 他の Mod の電気のブロック（FE を使うもの）。
- 規則の一覧（`tests/verification/rules.ts`）への登録と、ゲームでの確かめ。
