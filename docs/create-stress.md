# Create の応力計算の仕様

作成日: 2026-10-19 / Issue: #28 / 使う Issue: #30（`KineticGraph`）/ 設計: [design.md](design.md)

Create の回転（RPM）と応力（SU）の規則を、Create のソースコードから読み取ってまとめる。#30 はこの書類だけで `KineticGraph` と `CreateValueResolver` を作れるようにする。コードは写さず、規則だけを書く。

## 対象のバージョンと出典

| 環境 | Minecraft | Create | 読んだソース |
| --- | --- | --- | --- |
| ATM10 | NeoForge 1.21.1 | 6.0 系 | [Creators-of-Create/Create](https://github.com/Creators-of-Create/Create) の `mc1.21.1/dev`（commit `7ff2760`、`mod_version = 6.0.11`） |
| Create Astral | Fabric 1.18.2 | Create Fabric 0.5.1 系 | [Fabricators-of-Create/create](https://github.com/Fabricators-of-Create/create) の `mc1.18/fabric/dev`（commit `80ecefb`、`mod_version = 0.5.1-i`） |

- Create Astral に入っている jar は `create-fabric-0.5.1-f-build.1415+mc1.18.2`（`fabric.mod.json` の `version`。2026-10-25 に手元の Create Astral で確認）。読んだソースの `0.5.1-i` より少し前の版。f と i のコードの違いは確かめていない。Modpack の設定ファイルが書いていないブロックの値（下の「Create Astral の設定」）は、ワールドの設定ファイルに補われた値がこの書類の初期値と一致した。
- 回転の伝わり方（`RotationPropagator`）と応力の合計（`KineticNetwork`）は、2つの版で同じ。違いは書式の細部だけ（下の「バージョンの違い」）。
- 応力の初期値は、2つの版で同じ（`create:chain_conveyor` は 6.0 だけにある）。
- Create のコードは MIT License（1.21.1 版は「The Create Team / The Creators of Create」、1.18 Fabric 版は「2019 simibubi」）。`src/main/resources/assets/` 以下（テクスチャ・モデルなど）は All Rights Reserved なので使わない。数値はコードの中の定数なので、MIT の条件（著作権表示と許諾表示）を README の注記に書けば内蔵してよい。

以下、ソースのパスは `src/main/java/com/simibubi/create/` からの相対パスで書く。

**規則 ID。** 規則ごとに `ST-` で始まる ID を付ける（docs/verification.md「3. 規則の一覧」）。表の行・見出し・手順の1つが1つの規則。テストの名前に `[ST-…]` の形で入れる。規則ごとの出典と確かめた段階は `tests/verification/rules.ts` に持ち、`tests/verification/rules.test.ts` が、書類の ID・テストに出てくる ID・`rules.ts` の三つが一致することを調べる。

## 単位と符号

- **回転数（speed）**：RPM。符号付き。符号はブロックの回転軸の正の向き（x・y・z の正）を基準にする。見た目の時計回りとは対応させない。
- **応力（stress）**：SU。機械が消費する量。
- **容量（capacity）**：SU。動力源が供給できる量。
- 設定ファイルと内蔵の初期値は、どちらも **1 RPM あたり** の値（impact / capacity）。実際の量は回転数の絶対値を掛ける。
  - 機械の応力 = impact × |その機械の回転数|
  - 動力源の容量 = capacity × |その動力源が生む回転数|（今の回転数ではない。下の「容量の数え方」）

## 値の出どころ

design.md の「値の出どころ」に当てはめる。

| 値 | ① | ② | ③ |
| --- | --- | --- | --- |
| impact / capacity（Modの定数） | Modpack の `create-server.toml` | — | 内蔵の初期値（下の表） |
| 回転数の上限など（Modの定数） | Modpack の `create-server.toml` | — | 内蔵の初期値 |
| 動力源・速度コントローラーの設定（個体の設定値） | 設計図の nbt | — | 内蔵の初期値（Create のコードの初期値） |
| 回転のつながり（構造） | ブロック状態 | nbt（チェーンコンベアの接続先など） | — |

Create には「個体の設定値の初期値」を変える設定がない。そのため個体の設定値の ② は使わない。

### 設定ファイルの場所

応力の値は **サーバー設定**（`ModConfig.Type.SERVER`）に入る（`infrastructure/config/AllConfigs.java`、`CServer.java`、`CKinetics.java`、`CStress.java`）。

- ファイル名は `create-server.toml`。
- ワールドごとに `saves/<ワールド名>/serverconfig/create-server.toml` に作られる。ワールドを一度開くまでファイルはない。
- Modpack が初期値を変えている場合は、Modpack のフォルダの `defaultconfigs/create-server.toml` にある。新しいワールドはこれを写して作られる。
- 1.18.2 の Fabric 版も、Forge Config API Port を通して同じ場所・同じ形式で保存する。Create Astral の実物で確認した（`saves/新規ワールド/` と `saves/設計用/` の `serverconfig/create-server.toml`。Create の `fabric.mod.json` が `forgeconfigapiport` に依存している）。
- ゲームは、ワールドを開くときに、ワールドの設定ファイルにない項目を初期値で補い、決まった場所に並べ直して書き戻す。そのため、計算に実際に使われるのはワールドの設定ファイルの値。`defaultconfigs/` のファイルは古い形のまま残っていることがある（下の「Create Astral の設定」）。

`ST-CONFIG-SEARCH` `CreateConfig.load(pack)` が探す順番：

1. `saves/*/serverconfig/create-server.toml`（ゲームが実際に使うもの。複数あれば名前順で先頭を使い、仮定に載せる）
2. `defaultconfigs/create-server.toml`（ワールドがまだないとき）
3. なければ `null`（内蔵の初期値を使う）

`ST-CONFIG-FALLBACK` 設定ファイルの表にないブロックは、内蔵の初期値を使う（ゲームも足りない項目を初期値で補う）。初期値も分からないブロックだけ 0。

### Create Astral の設定

手元の Create Astral（2026-10-25）の `defaultconfigs/create-server.toml` と、2つのワールドの `serverconfig/create-server.toml` を、アプリの読み込み（`readCreateServerConfig`）で読み、内蔵の初期値（下の「数値の表」）と比べた。2つのワールドの値は同じで、Modpack が次の値を変えている。

| 表 | ブロック（`create:`） | 初期値 | Create Astral |
| --- | --- | --- | --- |
| impact | `crushing_wheel` | 8 | 12 |
| impact | `mechanical_pump` | 4 | 6 |
| impact | `shaft`, `andesite_encased_shaft`, `brass_encased_shaft` | 0 | 0.02 |
| impact | `cogwheel`, `andesite_encased_cogwheel`, `brass_encased_cogwheel` | 0 | 0.025 |
| impact | `belt` | 0 | 0.05 |
| impact | `large_cogwheel`, `andesite_encased_large_cogwheel`, `brass_encased_large_cogwheel`, `gearbox`, `gearshift`, `clutch`, `encased_chain_drive`, `adjustable_chain_gearshift`, `sequenced_gearshift`, `display_board` | 0 | 0.1 |
| impact | `gantry_shaft` | 0 | 0.2 |
| impact | `flywheel`, `rotation_speed_controller` | 0 | 1 |
| capacity | `water_wheel` | 32 | 16 |
| capacity | `windmill_bearing` | 512 | 1024 |
| capacity | `hand_crank` | 8 | 10 |

- シャフトや歯車にも小さな応力がある。長い軸や歯車の列では、合計が目に見えて変わる。
- 色付きのバルブのハンドルは、設定ファイルに色ごとの項目（どれも 8）がある。ゲームは色ごとの項目を使わず、`copper_valve_handle` の項目を使う（`ST-CAPACITY-VALVE-HANDLE`。ソースで確かめた）。
- `maxRotationSpeed`・`maxMotorSpeed` は 256、`disableStress` は false、中速・高速は 30・100 で、初期値のまま。
- **`defaultconfigs/` のファイルは古い形。** `large_water_wheel`（capacity）、`elevator_pulley`・`netherite_backtank`（impact）の項目がない。中速・高速は `[kinetics.stats]` ではなく `[kinetics.stressValues.stats]` に書いてある。ゲームはワールドを作るときにこれを写し、足りない項目を初期値（128・4・4）で補い、中速・高速を正しい場所に移している。
- **アプリの読み方。** 以前のアプリは `defaultconfigs/` を先に使い、表にないブロックを 0 とみなしていたので、Create Astral では大きい水車の容量が 0 になっていた。ワールドの設定ファイルを先に使い、設定ファイルにない項目は内蔵の初期値を使うように直した（#111）。手元の Create Astral では、大きい水車は 128（ワールドの設定ファイルの値）になる。

### TOML の形

`ST-CONFIG-TOML` 見出しの形は、Create Astral のワールドの設定ファイルで確かめた（`[kinetics.stressValues.v2.impact]`・`[kinetics.stressValues.v2.capacity]`・`[kinetics.stats]`）。実物はタブで字下げし、数は `8.0` のように小数で書く。

```toml
[kinetics]
  maxRotationSpeed = 256
  disableStress = false
  [kinetics.stats]
    mediumSpeed = 30.0
    fastSpeed = 100.0
  [kinetics.stressValues.v2.impact]
    mechanical_press = 8.0
    # ...
  [kinetics.stressValues.v2.capacity]
    creative_motor = 16384.0
    # ...
```

- `stressValues.v2` の `v2` は版の番号。Create がこの番号を上げると古い値は捨てられる。読み込みでは `kinetics.stressValues.v*` のうち番号が一番大きいものを使う。
- キーは `create:` を外したブロック名（`mechanical_press`）。値は小数。
- `impact` / `capacity` の表に載るのは Create 本体のブロックだけ（他の Mod のブロックは載せられない作り）。表に載るブロックは、ゲームが初期値で補うので、ワールドの設定ファイルにはすべて書いてある。古い形の `defaultconfigs/` などで項目がないときは、内蔵の初期値を使う。初期値の表にもないブロックは 0。
- 追加 Mod（アドオン）は自分の設定ファイルで値を持つ。対象外とし、仮定に載せる。

使う項目：

| キー | 初期値 | 意味 |
| --- | --- | --- |
| `kinetics.maxRotationSpeed` | 256 | これより速く回るとブロックが壊れる |
| `kinetics.disableStress` | false | true なら応力を計算しない（過負荷にならない） |
| `kinetics.stats.mediumSpeed` | 30 | 「中速」の下限。ミキサーなどの必要回転数 |
| `kinetics.stats.fastSpeed` | 100 | 「高速」の下限（表示用） |
| `kinetics.windmillSailsPerRPM` | 8 | 風車の帆の数 ÷ これ = RPM |
| `kinetics.minimumWindmillSails` | 8 | 風車を組み立てられる最少の帆の数 |
| `kinetics.maxBeltLength` | 20 | ベルトの最大長（検査用） |
| `kinetics.stressValues.v2.impact.*` | 下の表 | 1 RPM あたりの消費 |
| `kinetics.stressValues.v2.capacity.*` | 下の表 | 1 RPM あたりの供給 |

## 数値の表

出典：`AllBlocks.java` の `CStress.setImpact` / `setCapacity` / `setNoImpact`、`foundation/data/BuilderTransformers.java`（ケース入りシャフト・歯車、鳩時計、ピストン、バックタンク）。1.18.2 版は `content/kinetics/BlockStressDefaults.java` 経由で同じ値。ライセンスは MIT（上記）。

### 消費（impact、SU/RPM）

`ST-IMPACT` 下の表の値。すべてのブロックで、Create のソースから作った一覧（`tests/verification/blocks/`）と一致することを調べる。

| ブロック（`create:`） | impact | 必要回転数 |
| --- | --- | --- |
| `mechanical_press`, `crushing_wheel` | 8 | |
| `mechanical_mixer` | 4 | 中速（30 RPM 以上） |
| `millstone`, `turntable`, `mechanical_drill`, `mechanical_saw`, `deployer`, `mechanical_pump`, `mechanical_bearing`, `clockwork_bearing`, `rope_pulley`, `elevator_pulley`, `hose_pulley`, `mechanical_piston`, `sticky_mechanical_piston`, `copper_backtank`, `netherite_backtank` | 4 | |
| `encased_fan`, `weighted_ejector`, `mechanical_crafter`, `mechanical_arm` | 2 | |
| `cuckoo_clock`, `mysterious_cuckoo_clock`, `chain_conveyor`（6.0 のみ） | 1 | |
| `shaft`, `cogwheel`, `large_cogwheel`, `andesite_encased_shaft`, `brass_encased_shaft`, `andesite_encased_cogwheel`, `brass_encased_cogwheel`, `andesite_encased_large_cogwheel`, `brass_encased_large_cogwheel`, `gearbox`, `clutch`, `gearshift`, `encased_chain_drive`, `adjustable_chain_gearshift`, `belt`, `rotation_speed_controller`, `sequenced_gearshift`, `flywheel`, `gantry_shaft`, `speedometer`, `stressometer`, `display_board` | 0 | `display_board` は中速 |
| 表にないもの（`powered_shaft`, `metal_girder_encased_shaft`, `gantry_carriage` など） | 0 | |

`ST-MIN-SPEED` 必要回転数は `IRotate.getMinimumRequiredSpeedLevel` を上書きしているもの（`mechanical_mixer`、`display_board`）だけ。足りなくても応力は数える。機械が動かないことを `issues` に出す。

### 供給（capacity、SU/RPM）と生む回転数

`ST-CAPACITY` 下の表の capacity。`ST-IMPACT` と同じく、Create のソースの一覧と一致することを調べる。

| ブロック（`create:`） | capacity | 生む回転数 | 実際の容量（初期値） |
| --- | --- | --- | --- |
| `creative_motor` | 16384 | nbt の設定値（初期値 16、範囲 −256〜256） | 16 RPM で 262,144 SU |
| `water_wheel` | 32 | 8 RPM | 256 SU |
| `large_water_wheel` | 128 | 4 RPM | 512 SU |
| `windmill_bearing` | 512 | 帆の数 ÷ 8（1〜16 RPM） | 512〜8,192 SU |
| `hand_crank` | 8 | 32 RPM（回している間だけ） | 256 SU |
| `copper_valve_handle` と色付きの `*_valve_handle` | 8 | 32 RPM（回している間だけ） | 256 SU |
| `steam_engine`（`powered_shaft` が受け取る） | 1024 | 16 / 32 / 48 / 64 RPM | 効率 1 で 16,384 SU |

- `ST-CAPACITY-VALVE-HANDLE` 色付きのハンドルは `copper_valve_handle` の値を使う（`content/kinetics/crank/HandCrankBlockEntity.java` の `getStressConfigKey`。0.5.1 と 6.0 で同じ）。そのため 6.0 の `AllBlocks` で色付きのハンドルに `setCapacity` がなくても、ゲームでは銅のハンドルと同じ容量になる。
- 蒸気エンジンの計算は下の「動力源の回転数」。

## ブロックの回転軸と「軸の口」

`KineticGraph` は、ブロックごとに次の4つを決める。

- **回転軸** `axis`
- **軸の口** `shaftFaces`：シャフトとしてつながる面（`IRotate.hasShaftTowards`）
- **歯車** `cog`：`none` / `small` / `large`（`ICogWheel`）
- **面の係数** `faceFactor`：ギアボックスなど、面ごとに回転が変わるもの（下の節）

ブロック状態のプロパティ名は Minecraft の書き方に合わせる。水平の向き（コードの `HORIZONTAL_FACING`）も、.nbt では `facing` という名前で入る。水平の軸（`HORIZONTAL_AXIS`）は `axis`（値は `x` / `z`）。

`f` = `facing` の向き、`f'` = その反対、`cw(f)` = `f` を上から見て時計回りに 90° 回した向き。

| 規則 | ブロック | 回転軸 | 軸の口 | 歯車 |
| --- | --- | --- | --- | --- |
| `ST-AXIS-SHAFT` | `shaft`, `powered_shaft`, `*_encased_shaft`, `metal_girder_encased_shaft`, `flywheel`, `crushing_wheel`, `clutch`, `gearshift` | `axis` | 軸の両側 | なし |
| `ST-AXIS-COGWHEEL` | `cogwheel` | `axis` | 軸の両側 | 小 |
| `ST-AXIS-LARGE-COGWHEEL` | `large_cogwheel` | `axis` | 軸の両側 | 大 |
| `ST-AXIS-ENCASED-COG` | `*_encased_cogwheel` / `*_encased_large_cogwheel` | `axis` | 軸の正の側は `top_shaft=true` のとき、負の側は `bottom_shaft=true` のとき | 小 / 大 |
| `ST-AXIS-GEARBOX` | `gearbox` | `axis` | `axis` 以外の4面 | なし |
| `ST-AXIS-CHAIN-DRIVE` | `encased_chain_drive`, `adjustable_chain_gearshift` | `axis` | 軸の両側 | なし（チェーンで横につながる） |
| `ST-AXIS-SPEED-CONTROLLER` | `rotation_speed_controller` | `axis`（x/z） | 軸の両側 | なし |
| `ST-AXIS-SEQUENCED-GEARSHIFT` | `sequenced_gearshift` | `vertical=true` なら y、それ以外は `axis` | 軸の両側 | なし |
| `ST-AXIS-CREATIVE-MOTOR` | `creative_motor` | `f` の軸 | `f` の面だけ | なし |
| `ST-AXIS-WATER-WHEEL` | `water_wheel` | `f` の軸 | 軸の両側 | なし |
| `ST-AXIS-LARGE-WATER-WHEEL` | `large_water_wheel` | `axis` | 軸の両側 | なし |
| `ST-AXIS-CRANK` | `hand_crank`, `*_valve_handle`, `encased_fan`, `mechanical_drill` | `f` の軸 | `f'` の面だけ | なし |
| `ST-AXIS-BEARING` | `windmill_bearing`, `mechanical_bearing`, `clockwork_bearing` | `f` の軸 | `f'` の面だけ | なし |
| `ST-AXIS-SAW` | `mechanical_saw` | 水平向きなら `f` の軸、上下向きなら下の「向きと軸」 | 水平向きなら `f'`、上下向きなら軸の両側 | なし |
| `ST-AXIS-DIRECTIONAL` | `deployer`, `mechanical_piston`, `sticky_mechanical_piston`, `speedometer`, `stressometer`, `fluid_valve`, `gantry_carriage` | 下の「向きと軸」 | 軸の両側 | なし（`gantry_carriage` は下の規則 9 でもつながる） |
| `ST-AXIS-PRESS` | `mechanical_press` | `f` の軸 | 軸の両側 | なし |
| `ST-AXIS-CUCKOO-CLOCK` | `cuckoo_clock`, `mysterious_cuckoo_clock` | `f` の軸 | `f'` の面だけ | なし |
| `ST-AXIS-EJECTOR` | `weighted_ejector`, `elevator_pulley` | `cw(f)` の軸 | 軸の両側 | なし |
| `ST-AXIS-HOSE-PULLEY` | `hose_pulley` | `cw(f)` の軸 | `cw(f)` の面だけ | なし |
| `ST-AXIS-ROPE-PULLEY` | `rope_pulley` | `axis` | 軸の両側 | なし |
| `ST-AXIS-GANTRY-SHAFT` | `gantry_shaft` | `f` の軸 | 軸の両側 | なし |
| `ST-AXIS-BELT` | `belt` | `slope=sideways` なら y、それ以外は `cw(f)` の軸 | `part` が `middle` 以外のとき軸の両側 | なし |
| `ST-AXIS-MILLSTONE` | `millstone` | y | 下の面だけ | 小 |
| `ST-AXIS-TURNTABLE` | `turntable` | y | 下の面だけ | なし |
| `ST-AXIS-MIXER` | `mechanical_mixer`, `mechanical_arm`, `chain_conveyor`※ | y | なし（※チェーンコンベアは上下の両方） | 小（チェーンコンベアはなし） |
| `ST-AXIS-CRAFTER` | `mechanical_crafter`, `display_board` | `f` の軸 | なし | 小 |
| `ST-AXIS-PUMP` | `mechanical_pump` | `f` の軸 | なし | 小 |
| `ST-AXIS-BACKTANK` | `copper_backtank`, `netherite_backtank` | y | 上の面だけ | なし |

**向きと軸**（`ST-AXIS-DIRECTIONAL`。`DirectionalAxisKineticBlock`、プロパティ `axis_along_first`）：`facing` の軸が x なら `axis_along_first=true` で y、false で z。y なら true で x、false で z。z なら true で x、false で y。

出典：各ブロックの `hasShaftTowards` と `getRotationAxis`（`content/kinetics/**/*Block.java`、`content/contraptions/bearing/BearingBlock.java` など）。

## つながりの規則と速度比

2つのブロック A、B がつながるとき、**速度比** `r(A→B)` を決める。B の回転数 = A の回転数 × r。逆向きは `1 / r`。r が 0 ならつながらない。出典は `content/kinetics/RotationPropagator.java` の `getRotationSpeedModifier`。上から順に判定し、最初に当てはまったものを使う。

`ST-LINK-NEIGHBORS` 調べる相手の位置：

- 6方向の隣
- 小歯車（と斜めのベルト）：回転軸に垂直な面の上の斜め4マス
- 大歯車：斜めの12マス全部（差の2乗の和が 2 の位置）
- ベルト：同じベルトの他の区間（下の「ベルト」）
- チェーンコンベア（6.0）：nbt の `Connections` にある位置

### 1. シャフト同士（軸）

`ST-LINK-SHAFT`

A と B が隣り合い、A の向き d の面と B の反対の面の両方に軸の口があるとき。

`r = faceFactor(A, d) / faceFactor(B, d')`。ふつうのブロックの面の係数は 1 なので r = 1。

### 2. チェーンドライブ同士

`ST-LINK-CHAIN`

`encased_chain_drive` / `adjustable_chain_gearshift` が隣り合い、チェーンでつながっているとき。

- つながる向き（connection axis）：`axis_along_first=true` なら（`axis` が x なら y、それ以外は x）、false なら（`axis` が z なら y、それ以外は z）。
- 両方のつながる向きが同じで、隣の向きがその軸に沿っていること。
- `part` が `start` か `middle` なら正の向きの隣と、`end` か `middle` なら負の向きの隣とつながる。`none` はつながらない。
- `r = m(A) / m(B)`。`m` はチェーンドライブなら 1、可変チェーンギアシフトなら nbt の `Signal`（レッドストーンの強さ）が 0 のとき 1、それ以外は `1 + (Signal + 1) / 16`。

### 3. 大歯車同士

`ST-LINK-LARGE-LARGE`

両方が大歯車で、回転軸が違い、差（B − A）が A の軸と B の軸の成分で 0 でなく、残りの成分が 0（直角に組んだ斜め）。

`r = (A の軸の成分 > 0) XOR (B の軸の成分 > 0) ? −1 : 1`

### 4. 大歯車と小歯車

`ST-LINK-LARGE-SMALL`

軸が同じで、差の軸の成分が 0、残り2成分の絶対値がどちらも 1（同じ面の斜め）。

- 大 → 小：`r = −2`
- 小 → 大：`r = −0.5`

### 5. 小歯車同士

`ST-LINK-COG`

両方が小歯車で、6方向の隣、回転軸が同じ、隣の向きが回転軸と違う。`r = −1`。

軸の向きに重ねた小歯車は、歯車ではかみ合わない（1. のシャフトとしてつながる）。大歯車同士は軸が同じなら、かみ合わない。

### 6. 速度コントローラー

`ST-LINK-CONTROLLER`

`rotation_speed_controller` の真上に大歯車があり、大歯車の軸が水平で、コントローラーの `axis` と違うとき。比ではなく、大歯車の回転数を nbt の設定値（`ScrollValue`、初期値 16、範囲 ±256）にする。下の「計算の手順」で別に扱う。

### 7. ベルト

`ST-LINK-BELT`

- 同じベルトの区間同士は `r = 1`（同じ `Controller` を持つ区間。`content/kinetics/belt/BeltBlockEntity.java` の `propagateRotationTo`）。
- `part` が `start` / `end` / `pulley` の区間は軸の口を持ち、1. でシャフトとつながる。

**ベルトはブロック状態だけで組み立てられる。** 区間の並びは `BeltBlock.nextSegmentPosition` の規則で決まる。

- `part=start` から始めて、`part=end` まで次の区間に進む。
- 次の区間：`slope=vertical` なら上下に1つ（`facing` が正の向きなら上、負なら下）。それ以外は `facing` の向きに1つ。さらに `slope=upward` なら1つ上、`downward` なら1つ下。
- 途中のブロックがベルトでなければ、そこで切れる。`end` に届く前に設計図の外に出たら、仮定に載せる。

nbt の `Controller`・`Index`・`Length` は確かめに使えるが、必須ではない。`Controller` はワールド座標なので、設計図の中の位置には直せない。

### 8. チェーンコンベア（6.0 のみ）

`ST-LINK-CHAIN-CONVEYOR`

nbt の `Connections`（相手への相対位置の集合）に入っている相手が `chain_conveyor` なら `r = 1`。相手が設計図の外なら仮定に載せる。

### 9. ガントリー

`ST-LINK-GANTRY`

`gantry_shaft`（A）が `powered=true` で、隣の `gantry_carriage`（B）が A から見て B の `facing` の向きにあるとき（台車はシャフトから外へ向く）。台車の歯車がシャフトとかみ合う。出典は `GantryShaftBlockEntity.propagateRotationTo`・`isCustomConnection` と `GantryCarriageBlockEntity.propagateRotationTo`（0.5.1 と 6.0 で同じ）。

`r(A→B)` = `getGantryPinionModifier(A の facing, B の facing)`。逆向き（台車からシャフト）も同じ値（±1 なので `1 / r` と一致する）。

- s = A の `facing` が軸の正の向き（east・up・south）なら 1、負なら −1。
- A の `facing` の軸が y で、B の `facing` が north か east なら `r = −s`。
- 軸が x で、B の `facing` が down か south なら `r = −s`。
- 軸が z で、B の `facing` が up か west なら `r = −s`。
- それ以外は `r = s`。

`powered=false` のシャフトは、回ると台車を仕掛けとして動かす。台車の歯車とはつながらない（`r = 0`）。台車の応力は 0（`AllBlocks` に `setImpact` がない）。台車は軸の口（上の表）でも、ほかのシャフトとつながる。

## 面の係数（ギアボックス・ギアシフト・クラッチ）

Create はギアボックスなどの比を「どの面から回転が来たか」で決める（`RotationPropagator.getAxisModifier`、`content/kinetics/transmission/*BlockEntity.java`）。そのままだと伝わる順番に依存するので、順番によらない形に直した。面 e の回転数 = ブロックの内部の値 C × `faceFactor(e)` とする。

### ギアボックス（`gearbox`）

`ST-FACE-GEARBOX`

`faceFactor(e) = a(e) × s(e の軸)`

- `a(e)`：e が正の向きなら +1、負なら −1。
- `s`：`axis` 以外の2つの軸を x, y, z の順に並べ、1つ目を +1、2つ目を −1。

例：`axis=y` のギアボックスに西（−x）から +16 が入る。西の面の係数は −1 なので C = −16。東 +1 → −16、北（−z）+1 → −16、南 −1 → +16。Create のコードで計算した結果と一致する（入った面の反対の面は逆回り、横の面は向きによって変わる）。

### ギアシフト（`gearshift`）

`ST-FACE-GEARSHIFT`

`powered=false` なら両面とも 1。`powered=true` なら軸の正の面を 1、負の面を −1（2つの面の比が −1 になればよい）。

### クラッチ（`clutch`）

`ST-FACE-CLUTCH`

`powered=false` なら両面とも 1。`powered=true` なら2つの面の間を切る（つながりなし）。クラッチ自身は応力 0 なので、どちらの側に属しても結果は変わらない。

### シーケンスギアシフト（`sequenced_gearshift`）

`ST-FACE-SEQUENCED-GEARSHIFT`

命令を実行中だけ回転を伝え、待機中は出力側を切る。実行中の状態は時間で変わるので、**待機中（powered=true のクラッチと同じ）とみなし**、仮定に載せる。

## 動力源の回転数

`getGeneratedSpeed` の規則。生む回転数は「その動力源が単独で回すときの回転数」。

| 規則 | ブロック | 生む回転数 | 値の出どころ |
| --- | --- | --- | --- |
| `ST-SOURCE-CREATIVE-MOTOR` | `creative_motor` | `ScrollValue`（初期値 16）。`facing` が負の向き（down / north / west）なら符号を反転 | nbt → 内蔵 16 |
| `ST-SOURCE-WATER-WHEEL` | `water_wheel` / `large_water_wheel` | `clamp(FlowScore, −1, 1) × 8 / 大きさ`（大きさは小 1、大 2） | nbt の `FlowScore`。ないときは +1 と仮定 |
| `ST-SOURCE-WINDMILL` | `windmill_bearing` | 回っているとき `clamp(帆の数 / 8, 1, 16) × (時計回りなら +1、反時計回りなら −1)` | nbt の `Running` と `LastGenerated`。ないときは 0 とし、仮定に載せる |
| `ST-SOURCE-CRANK` | `hand_crank` / `*_valve_handle` | 回している間だけ `(Backwards なら −1、それ以外は +1) × 32`。`facing` が負の向きなら符号を反転 | 回しているとみなし（仮定）、向きは nbt の `Backwards` |
| `ST-SOURCE-STEAM-ENGINE` | `powered_shaft`（蒸気エンジン） | `Direction × 16 × k`。k = 効率が 1 以上なら 4、それ以外は `1 + min(2, floor(効率 × 4))` | nbt の `EnginePower`（効率）、`Direction`、`EngineType`。ないときは 0 とし、仮定に載せる |

- 蒸気エンジンの容量（1 RPM あたり）は `効率 × capacity(EngineType) / k`。実際の容量は `効率 × 1024 × 16`（効率 1 で 16,384 SU）。効率はボイラー（流体タンク）の大きさと熱で決まる。保存された状態ではタンクから計算せず、生データの `EnginePower` を使う。動かしたときはタンクから計算する（下の「動かしたとき」）。
- 風車の帆は、組み立て中は仕掛けのエンティティになる。保存された状態では、設計図に帆のブロックがあっても数えない（未確認事項）。動かしたときは帆のブロックを数える（下の「動かしたとき」）。

## 動かしたとき（#243）

`ST-RUN-MODE` 計算には2つの見方がある。

| 見方 | 動力源の状態 |
| --- | --- |
| 保存された状態 | 生データに保存された状態をそのまま使う（上の「動力源の回転数」）。冷えたまま保存したボイラーの蒸気エンジンや、組み立てる前の風車は止まっている |
| 動かしたとき | 蒸気エンジンと風車を、設計図の中身から動かしたものとして計算する。ほかの動力源は保存された状態と同じ |

- 水車とハンドルは、保存された状態でもすでに回っているとみなしている（`ST-SOURCE-WATER-WHEEL`・`ST-SOURCE-CRANK`）。クリエイティブモーターは設定値で回る。見方で変わるのは蒸気エンジンと風車だけ。
- 初めは「動かしたとき」にする。アプリで作った設計図には保存された状態がないので、保存された状態では蒸気エンジンと風車がいつも止まるため。切り替えは docs/ui.md「右パネル」。
- 動かしたときに推測で埋めた値は、すべて仮定に載せる。
- 計算のほかの手順（つながり、速度比、応力の合計）は、2つの見方で同じ。

### ボイラーと蒸気エンジン

出典は `content/fluids/tank/BoilerData.java`・`BoilerHeaters.java`、`content/kinetics/steamEngine/SteamEngineBlockEntity.java`・`SteamEngineBlock.java`、`content/processing/burner/BlazeBurnerBlock.java`。2つの版で同じ（水の量の単位だけ違い、Fabric は 81 倍）。

`ST-RUN-BOILER-TANK` ボイラーは、流体タンク（`fluid_tank`）の組1つ。組の主（一番小さい x・y・z の角）の生データに `Size`（幅）と `Height`（高さ）がある。組は、主から x・z に幅、y に高さの箱で、大きさは `幅 × 幅 × 高さ`（`FluidTankBlockEntity.getTotalTankSize`）。

- 主の生データがない（アプリで置いたタンクなど）ときは、`bottom=true` から `top=true` まで縦に続く1列を、幅 1 のタンクとみなし、仮定に載せる。
- 組が設計図の外にはみ出すときは、中にある分だけを大きさに数え、仮定に載せる（範囲外は空気とみなす規則と同じ考え）。

`ST-RUN-BOILER-HEAT` 熱は、組の一番下の段の真下（幅 × 幅の位置）のブロックごとに決め、合計する（`BoilerData.updateTemperature`）。

| 真下のブロック | 熱 |
| --- | --- |
| `blaze_burner`（`blaze=seething`） | 2 |
| `blaze_burner`（`blaze=kindled`・`fading`） | 1 |
| `blaze_burner`（`blaze=smouldering`） | 1。燃料を入れたとみなす（仮定）。ゲームでは燃料がないと弱い熱 |
| `blaze_burner`（`blaze=none`） | なし |
| `magma_block`・`lava`・`fire`・`soul_fire`、火のついた `campfire`・`soul_campfire`（`lit=true`） | 弱い熱（`passive_boiler_heaters` のタグ） |
| ほか | なし |

- 弱い熱は、ほかの熱（1 以上）が1つもないときだけ効く。

`ST-RUN-BOILER-WATER` 水は足りているとみなし、水による段階の上限を 18 にする。仮定に載せる。ポンプと管から水の量を出すのは、まだしない（ゲームでは 1 段あたり毎 tick 10 mB）。

`ST-RUN-BOILER-LEVEL` 段階 = `min(熱の合計, 水の上限 18, min(18, floor(大きさ / 4)))`（`BoilerData.getActualHeat`）。

`ST-RUN-BOILER-ENGINES` 付いたエンジンは、組のどれかのタンクに面で接する蒸気エンジン（`steam_engine`）のうち、付いている向きが「タンクからエンジンへの向き」と同じもの（`BoilerData.evaluate`）。付いている向きは、`face=floor` なら上、`face=ceiling` なら下、`face=wall` なら `facing`（`SteamEngineBlock.getFacing`）。数を n とする。

`ST-RUN-BOILER-EFFICIENCY` エンジン1台の効率（`BoilerData.getEngineEfficiency`）。0〜1 に収める。

| 条件 | 効率 |
| --- | --- |
| 弱い熱だけで、大きさの上限と水の上限がどちらも 1 以上 | `(1 / 8) / n` |
| 熱の合計が 0 | 0 |
| n ≤ 段階 | 1 |
| それ以外 | `段階 / n` |

`ST-RUN-STEAM-SHAFT` エンジンが回す軸は、エンジンから付いている向きに2つ先のブロック（`SteamEngineBlock.getShaftPos`）。`powered_shaft` のほか、アプリで置いた `shaft` もエンジンの軸とみなす（ゲームでは置くと `powered_shaft` に変わる）。そこに軸がなければ、エンジンは何も回さない。

`ST-RUN-STEAM-DIRECTION` 向き = a × b × c（`SteamEngineBlockEntity.tick`）。

- a：効率が 0 か、軸が y なら +1。それ以外は、エンジンの向き（付いている向き。上か下なら `facing`）が正（east・up・south）なら +1、負なら −1
- b：軸が z なら −1、それ以外は +1
- c：エンジンの生データの `ScrollValue` が 1（反時計回り）なら −1、それ以外は +1

回転数と容量は `ST-SOURCE-STEAM-ENGINE` の式に、この効率と向きを入れる。`EngineType` は `create:steam_engine`。

`ST-RUN-STEAM-FLIP` ゲームは、軸がほかの動力源で逆向きに回っていると、エンジンの向きを裏返す（`ScrollValue` を変える）。動かしたときも、向きの衝突になるエンジンは裏返し、仮定に載せる。

`ST-RUN-STEAM-ONE-PER-SHAFT` 1本の軸に2台以上のエンジンが向いているときは、1台だけを使う。軸の生データの `EnginePos` が指すエンジンがあればそれ、なければ位置の小さい順（x・y・z）で最初のもの。仮定に載せる（ゲームでは先に付いた1台。未確認事項）。

### 風車

出典は `content/contraptions/bearing/WindmillBearingBlockEntity.java`・`BearingContraption.java`、`content/contraptions/Contraption.java`（`moveBlock`）・`BlockMovementChecks.java`。2つの版で同じ。

`ST-RUN-WINDMILL-SAVED` 生データで回っている（`Running` が true で `LastGenerated` がある）ときは、保存された状態と同じ回転数を使う。回している風車の帆はエンティティになり、設計図のブロックに残らないため。

`ST-RUN-WINDMILL-SAILS` 帆の数は、軸受（`windmill_bearing`）の `facing` の先のブロックから、仕掛けとして一緒に動くブロックをたどって数える。帆は `windmill_sails` のタグのブロック（`sail_frame`・`white_sail`・色付きの `*_sail`・羊毛 `*_wool`）。たどるつながりは次のとおり。

- 帆（`sail_frame`・`*_sail`）は、自分の `facing` の軸と違う向きの隣とつながる（`BlockMovementChecks.isBlockAttachedTowards`）
- 接着剤（`super_glue` のエンティティ）の箱の中で隣り合うブロックはつながる
- スライムブロック・ハチミツブロックは、隣とつながる

ほかのつながり（シャーシ、ブロックの付き方など）はたどらないので、帆を少なく数えることがある。たどったときは仮定に載せる。軸受の真後ろ（`facing` の反対）はたどらない。

`ST-RUN-WINDMILL-SPEED` 帆が `minimumWindmillSails`（初期値 8）より少なければ組み立てられないので 0 とし、問題に「帆が足りません」と出す。それ以外は `clamp(floor(帆の数 / windmillSailsPerRPM), 1, 16) × 向き`（`windmillSailsPerRPM` の初期値 8）。向きは、軸受の生データの `ScrollValue` が 1（反時計回り）なら −1、それ以外は +1。2つの設定は `create-server.toml` の `[kinetics]` にあれば使う。

## 計算の手順

`KineticGraph.build(bp, ports)` と `graph.evaluate(values)` の中身。

### データの形

```ts
// src/calc/create/ の中だけで使う
type Axis = 'x' | 'y' | 'z'

interface KineticNode {
  pos: Vec3
  id: string                        // 'create:shaft'
  axis: Axis
  shaftFaces: Direction[]
  cog: 'none' | 'small' | 'large'
  faceFactor: (face: Direction) => number   // ふつうは常に 1
  impact: Resolved<number>          // SU/RPM
  source: {                         // 動力源でなければ null
    speed: Resolved<number>         // 生む回転数（符号付き）
    capacity: Resolved<number>      // SU/RPM
  } | null
  minSpeed: number                  // 必要回転数。なければ 0
}

interface KineticEdge {
  a: number                         // ノードの番号
  b: number
  ratio: number                     // b の回転数 = a の回転数 × ratio
  kind: 'shaft' | 'cog' | 'large-small' | 'large-large' | 'chain' | 'belt' | 'chain-conveyor'
}

interface ControllerLink {
  controller: number                // 速度コントローラーのノード
  cog: number                       // 真上の大歯車のノード
  target: Resolved<number>          // ScrollValue
}
```

### 手順

1. `ST-STEP-NODES` **ノードを作る。** 設計図の各ブロックを上の表で引く。表にない `create:` のブロックは、回転しないものとして無視する。表にあるのに、回転軸を決めるブロック状態（`axis`・`facing` など）がないか値が読めないブロックは、ノードにせず **ブロック状態の不足** として `issues` に出す（ID だけで置いたときなど）。他の Mod のブロックも無視し、回転に関わりそうなもの（namespace が Create のアドオンのもの）は仮定に載せる。
2. `ST-STEP-EDGES` **辺を作る。** 各ノードの調べる相手について「つながりの規則」を判定し、`r ≠ 0` なら辺を足す。A→B と B→A の両方で判定し、どちらかでつながればよい（Create と同じ）。
3. `ST-STEP-OUT-OF-RANGE` **範囲外を記録する。** 軸の口や歯車の相手の位置が設計図の外のとき、空気とみなし、仮定に `{ pos, message: '範囲外は空気とみなした' }` を足す。その面に `VirtualPort` があれば、それを相手にする。
4. `ST-STEP-GROUPS` **剛体のまとまりに分ける。** 速度コントローラーのリンク以外の辺で連結成分を作る。これを「まとまり」と呼ぶ。まとまりの中では回転数の比が決まっている。
5. `ST-STEP-RATIOS` **比を決める。** まとまりの1つのノードを k = 1 とし、辺をたどって各ノードの k を決める（B の k = A の k × r）。すでに k があるノードに別の値が来たら、
   - 符号が違う → **向きの衝突**
   - 大きさが違う（相対誤差 1/65536 を超える）→ **速度の衝突**

   として `issues` に辺の位置を出す。そのまとまりの回転数は 0 とする（ゲームではどれかのブロックが壊れる）。
6. `ST-STEP-SPEED` **まとまりの回転数を決める。** まとまりの中の各動力源 s について、まとまりの倍率の候補 `x_s = 生む回転数(s) / k(s)` を求める（0 の動力源は除く）。
   - 候補の符号がそろわない → **向きの衝突**（ゲームではブロックが壊れる）
   - そろう → 絶対値が一番大きい候補を使う（速い動力源が遅い動力源を押し切る）
   - 候補がない → 動力なし（回転数 0）
   - 各ノードの回転数 = x × k
7. `ST-STEP-CONTROLLER` **速度コントローラーを解く。** 入力側のまとまりが回っていてコントローラーの回転数が 0 でなく、設定値も 0 でなければ、大歯車のまとまりに「大歯車の回転数 = 設定値」という動力源を足して 6. をやり直す。入力側が止まっていれば、出力側には何も足さない。依存の順番に処理し、コントローラーの輪（出力が入力に戻る）は仮定に載せて打ち切る。
8. `ST-STEP-MAX-SPEED` **速度の上限。** |回転数| が `maxRotationSpeed` を超えるノードがあれば **速度超過**（ゲームでは壊れる）。
9. `ST-STEP-NETWORKS` **ネットワークに分ける。** まとまりを速度コントローラーのリンクでつないだものが、Create の1つのネットワーク（応力を共有する範囲）。
10. `ST-STEP-STRESS` **応力と容量を足す。**
    - 応力 = Σ impact(n) × |回転数(n)|（ネットワークの全ノード）
    - 容量 = Σ capacity(s) × |生む回転数(s)|（ネットワークの全動力源。押し切られた動力源も数える）
11. `ST-STEP-OVERLOAD` **判定する。**
    - `disableStress=false` で **容量 < 応力** なら **過負荷**。ゲームではネットワーク全体の回転数が 0 になる。等しいときは過負荷にならない。
    - 回っていて |回転数| < minSpeed の機械は「回転数が足りない」として `issues` に出す。
12. `ST-STEP-STOPPED` **止まっているブロックを調べる（#148）。** 過負荷でも衝突でもないのに回転数が 0 のノードを、警告として `issues` に出す。
    - ネットワークに動力源（仮の動力源を含む）がない → **動力源につながっていない**
    - 動力源はあるが回転数が 0（動力源の回転数が 0、速度コントローラーの設定が 0 など）→ **止まっている**

### 容量の数え方

`ST-CAPACITY-GENERATED`

Create の `KineticNetwork.calculateCapacity` は、動力源の **生む回転数** で容量を数える。ほかの動力源に押し切られて別の速さで回っていても、容量は自分の生む回転数のまま。応力は **実際の回転数**（`getTheoreticalSpeed`、過負荷の前の値）で数える。

### 結果の形

`CalcResult` に次を入れる。

- `ST-RESULT-SUMMARY` `summary`：回路エディタのネット一覧にあたる（#152）。
  - 先頭に「ネットワーク n／過負荷 m／止まっている k」の集計を出す。別々のネットワークの使用と供給は足さない（足すと、どこかの過負荷が合計の余裕に隠れるため）。
  - 続けてネットワークごとに1行。「使用 n SU / 供給 m SU（余裕 r SU）、回転数の範囲。動力源 a・負荷 b・ブロック c」。余裕は供給−使用で、過負荷なら「足りない r SU」。回転数の範囲は、回っていなければ「止まっている」。動力源も負荷もない、軸だけのネットワークも出す。
  - 行には、そのネットワークのブロックの位置を1つ（`pos`）付ける。画面は行を押すと、その位置をプローブの対象にして、ネットワークを強調する。
  - 動力源は仮の動力源も数える。負荷は応力を使うブロック（仮の負荷を含む）。ブロックは設計図のブロックだけを数える。
- `ST-RESULT-ISSUES` `issues`：向きの衝突、速度の衝突、速度超過、回転数が足りない機械、ブロック状態の不足。ネットワーク全体の問題（過負荷）はネットワークごとに1件にまとめる（#153）。
  - 警告（`severity: 'warning'`）として、動力源につながっていないネットワークと止まっているネットワーク。これもネットワークごとに1件。警告は組み立て途中の設計図で多く出るので、3D・2D表示では強調しない。重さの段階の整理は #159。
  - まとめた問題は、位置（`pos`）にネットワークのブロックを1つ、`positions` にネットワークの全ブロックを入れ、文に「（ブロック n 個）」を添える。3D・2D表示の強調は `positions` の全部に付ける。
- `assumptions`：範囲外を空気とみなした位置、nbt がなく仮定した動力源、シーケンスギアシフトを待機中とみなしたこと、扱わないブロック。

`ST-RESULT-PROBE` ノードごとの回転数と応力は、プローブ（#31 など）で使えるように `KineticGraph` から引けるようにする。

## 仮の入出力（VirtualPort）

`pluginId: 'create-stress'` の種類：

| kind | params | 扱い |
| --- | --- | --- |
| `rotation-source`（`ST-PORT-SOURCE`） | `rpm`（符号付き）、`capacity`（その回転数での SU） | 付けたブロックが、その回転数で回るとする。ブロックと r = 1 でつながる動力源を足す。1 RPM あたりの容量 = capacity / |rpm| |
| `rotation-load`（`ST-PORT-LOAD`） | `stress`（SU。回転数によらない固定値）または `impact`（SU/RPM） | 付けたブロックと r = 1 でつながる負荷を足す |

- `ST-PORT-ATTACH` 面には付けない（#195）。付けたブロックが回転するブロック（ノード）でなければ、計算の問題に「つなげません」と出す。
- `ST-PORT-SIGN` `rpm` の符号は、付けたブロックの回転数の符号と同じにする（ブロックの軸の正の向きが基準。Create の回転数と同じ）。向きは利用者が選んでいないので、動力源ごとに仮定に「ブロックと同じ向きに回るとみなした」と載せる。画面では「時計回り / 反時計回り」でなく「+ / −」と出す。
- `ST-PORT-OUT-OF-RANGE` 仮の入出力を付けたブロックは、軸の口が設計図の外に出ていても範囲外として記録しない（外とのつながりを仮の入出力で表したとみなす）。
- 値の出どころは `virtual`。

## 生データ（nbt）の項目

すべてのブロックエンティティ（`content/kinetics/base/KineticBlockEntity.java`）：

| 項目 | 型 | 意味 | 使い方 |
| --- | --- | --- | --- |
| `Speed` | float | 保存時の回転数 | 参考。テストでゲームの結果と比べる |
| `Source` | 位置 | 回転をもらった相手（ワールド座標） | 使わない |
| `Network` | compound | `Id`, `Stress`, `Capacity`, `Size`, `AddedStress`, `AddedCapacity` | 参考値として表示するだけ（範囲外を含む） |

ブロックごと：

| ブロック | 項目 | 意味 |
| --- | --- | --- |
| `creative_motor`, `rotation_speed_controller` | `ScrollValue`（int） | 設定した回転数 |
| `water_wheel`, `large_water_wheel` | `FlowScore`（int）、`Material` | 水の流れの向き、見た目の木材 |
| `windmill_bearing` | `Running`（byte）、`LastGenerated`（float）、`ScrollValue`（回転の向き） | 回っているか、最後に生んだ回転数 |
| `hand_crank`, `*_valve_handle` | `InUse`（int）、`Backwards`（byte） | 回している残り時間、逆回し |
| `powered_shaft` | `Direction`（int）、`EnginePos`（相対位置）、`EnginePower`（float）、`EngineType`（string） | 蒸気エンジンの向き・位置・効率・種類 |
| `adjustable_chain_gearshift` | `Signal`（int） | レッドストーンの強さ |
| `sequenced_gearshift` | `InstructionIndex`, `Instructions` など | 命令の列と実行位置 |
| `belt` | `Controller`（ワールド座標）、`IsController`、`Length`、`Index`、`Casing`、`Covered`、`Inventory` など | ベルトの組 |
| `chain_conveyor`（6.0） | `Connections`（相対位置の集合） | つながるチェーンコンベア |

### 画面で変えられる項目

`ST-SETTING-SCROLL` 詳細パネルの「計算に使う設定」で変えられるのは、ゲームの中で利用者が決める値だけ（`calc/create/createBlockSettings.ts`）。

| ブロック | 項目 | 範囲 | 生データがないときに作るもの |
| --- | --- | --- | --- |
| `creative_motor` | `ScrollValue`（int、回転数） | −256〜256 | `{id: "create:motor", ScrollValue}` |
| `rotation_speed_controller` | `ScrollValue`（int、目標の回転数） | −256〜256 | `{id: "create:rotation_speed_controller", ScrollValue}` |

- 範囲は初期設定の上限（`maxMotorSpeed`・`maxRotationSpeed`、どちらも 256）。Modpack の設定で上限を変えている場合は考えない。
- `FlowScore`（水車）、`Running`・`LastGenerated`（風車）、`EnginePower`（蒸気エンジン）などは、ゲームが周りの状態から決め直す値なので、画面では変えない。
- [ ] アプリで作った生データ（`id` と `ScrollValue` だけ）を、ゲームが読んで同じ回転数になるか（#22 で確かめる）

### バージョンの違い

- 項目の名前は 1.18.2（0.5.1）と 1.21.1（6.0）で同じ。
- `ST-NBT-POS` 位置の書き方が違う。Minecraft 1.20.5 から `NbtUtils.writeBlockPos` が int 配列 `[x, y, z]` を書くようになった。1.18.2 は compound `{X, Y, Z}`。`Source`・`Controller`・`EnginePos` を読むときは両方を受け付ける（`EnginePos` は相対位置なので使える）。
- `chain_conveyor` は 6.0 で追加。1.18.2 には出てこない。

## 回転・反転

範囲を回す・反転するとき（docs/design.md「範囲の編集」、#132）の、Create のブロックの規則。`calc/create/createTransform.ts`。

ゲームが設計図を回して置くとき（スキーマティキャノン、クリエイティブの配置）は、バニラの `StructureTemplate.placeInWorld` で位置を写し、各ブロックの状態に `state.mirror(m).rotate(r)` を当てる（先に反転、次に回転）。そのあと、置いたブロックエンティティに `StructureTransform.apply(be)` を当てる。`StructureTransform.apply(BlockState)` は仕掛け（コントラプション）を組む・ばらすときだけ使い、設計図を置くときには使わない。アプリも同じ順（反転 → 回転）で、各ブロックの `rotate`・`mirror` の規則を写す。

- 規則には `TF-…` の ID を付ける（docs/verification.md「3. 規則の一覧」）。テストの名前にも同じ ID を書く。
- `TF-ORDER` 回転と反転を一度にするときは、先に反転し、次に回す。

### ブロック状態

`TF-VANILLA` バニラの向きのプロパティ（`axis`・`facing`・`horizontal_facing`、液体パイプの `north` など）はバニラの規則（docs/design.md）で変え、そのうえで次を変える。0.5.1 と 6.0 で同じ規則。

| 規則 | プロパティ（ブロック） | 回転 | 反転 |
| --- | --- | --- | --- |
| `TF-AXIS-ALONG-FIRST` | `axis_along_first`（デプロイヤー・鋸・ピストン・ガントリーなど。`DirectionalAxisKineticBlock`） | 90° の奇数回で入れ替える（向きによらない） | 変えない |
| `TF-SAW-FLIPPED` | `flipped`（上下を向いた `mechanical_saw`） | 右回りで `axis_along_first` が false、または左回りで true なら入れ替える。180° なら入れ替える | `axis_along_first` が true で x の反転、false で z の反転なら入れ替える |
| `TF-HORIZONTAL-AXIS` | `horizontal_axis`（`item_vault`・ベルトのトンネルなど） | 90° の奇数回で x ↔ z | 変えない |
| `TF-BELT-VERTICAL` | `part`（`slope=vertical` の `belt`） | 向きの正負（east・south が正）が変わったら start ↔ end | 同じ（反転で向きが逆になるときは 180° の回転と同じ） |
| `TF-ENCASED-COG-SHAFTS` | `top_shaft`・`bottom_shaft`（`*_encased_cogwheel`。`axis` が x・z のとき） | 180° なら入れ替える。右回りで `axis=z`、左回りで `axis=x` なら入れ替える | `axis` と反転の軸が同じなら入れ替える |
| `TF-CHAIN-DRIVE` | `part`・`axis`・`axis_along_first`（`encased_chain_drive`・`adjustable_chain_gearshift`） | つながる向きの軸（`axis` と `axis_along_first` から決まる）と `axis` を回し、`axis_along_first` を決め直す。つながる向きの正の端が負になれば start ↔ end | つながる向きの軸と反転の軸が同じなら start ↔ end |
| `TF-TANK-WINDOW` | `shape` の `window_ne` など（`fluid_tank`） | 右回りごとに ne → se → sw → nw → ne | x の反転で ne ↔ nw・se ↔ sw、z の反転で ne ↔ se・nw ↔ sw |
| `TF-CHASSIS-STICKY` | `sticky_north` など（シャーシ） | 値を回した面へ移す | 値を反転した面へ移す |
| `TF-CONTROLLER-RAIL` | `backwards`（`controller_rail`） | 180° なら入れ替える。90° では、z 向きのレールを左回り、または x 向きを右回りにしたとき入れ替える | z 向きのレールを z の反転、x 向きを x の反転で入れ替える |

`TF-UNHANDLED` 扱わないもの（向きのプロパティだけをバニラの規則で変える）：列車の線路（`TrackShape`）、桁（`girder` の `x`・`z`）、カードボードの包み、6.0 のレッドストーンリクエスターなど。

### 生データの中の位置

| 規則 | ブロック | 項目 | 相対か | アプリで |
| --- | --- | --- | --- | --- |
| `TF-NBT-ARM` | `mechanical_arm` | `InteractionPoints` の各 `Pos` | アームからの相対 | 回す・反転する |
| `TF-NBT-DISPLAY-LINK` | `display_link` | `TargetOffset` | 相対 | 回す・反転する（ゲームは 6.0 だけが直す。0.5.1 は直さないが、写した形が正しくなる方にそろえた） |
| `TF-NBT-CRAFTER` | `mechanical_crafter` | `ConnectedInput` の `Data` の各位置 | 相対 | 回す・反転する（ゲームは 6.0 だけ） |
| `TF-NBT-CHAIN-CONVEYOR` | `chain_conveyor`（6.0） | `Connections` の各位置 | 相対 | 回す・反転する |
| `TF-NBT-BELT-CONTROLLER` | `belt` | `Controller` | ワールド座標 | 変えない。スキーマティキャノンはベルトの生データを使わず、ベルトを組み直す（`BeltConnectorItem.createBelts`） |
| `TF-NBT-CONTROLLER` | `fluid_tank`・`item_vault` | `Controller`、`LastKnownPos` | ワールド座標 | 変えない。置くときにゲームが作り直す |
| `TF-NBT-SOURCE` | すべての回るブロック | `Source` | ワールド座標 | 変えない。ゲームが計算し直す |
| `TF-NBT-ENGINE-POS` | `powered_shaft` | `EnginePos` | 相対 | 変えない。エンジンが毎 tick 入れ直す |

- `TF-NBT-POS-FORM` 位置の形（int 配列 `[x, y, z]` か compound `{X, Y, Z}`）は、元の形のまま書く。
- `TF-NBT-OUTSIDE` 相対位置の相手が範囲の外なら、回しても相手は動かないので、操作の警告に出す（docs/design.md）。
- `TF-NBT-UNHANDLED` 扱わないもの：6.0 の `chain_conveyor` の `TravellingPackages` の `Target`、コピーキャットの `Material`・ブラケットの `Bracket`（中のブロック状態）、線路の `Connections`、工場のパネルの `Targeting`（ワールド座標）。
- [ ] 回して書き出した設計図を、スキーマティキャノンで置いて、機械アームの行き先・縦のベルト・チェーンドライブがゲームで正しく動くか

## 置き方・初期状態

置くツールで Create のブロックを置くとき（docs/ui.md「編集」、docs/design.md「置くブロック（ブラシ）」）の規則。置けるか・置き方の補助は `calc/create/createPlacement.ts`、足りない状態を補うのは `calc/create/createDefaultStates.ts`、基本の部品は `calc/create/createBasicBlocks.ts`。規則には `PL-…` の ID を付ける。

### 置けるか（#121）

ゲームが「その場所に残れるか」を調べる規則（`CogWheelBlock.isValidCogwheelPosition`。0.5.1 と 6.0 で同じ）。あとから隣に置かれても、外れて落ちる。

- `PL-COG-NEXT-TO-LARGE` 歯車（ケース入りを含む）の、軸に垂直な4方向の隣に大歯車があれば置けない。
- `PL-COG-LARGE-NEXT-TO-SMALL` 大歯車の、軸に垂直な4方向の隣に小歯車があれば置けない。
- `PL-COG-EXEMPT` 隣のブロックの `axis` がその向きの軸なら、その隣は問題にしない。軸の両端の隣は調べない。歯車でないブロックは調べない。

### 置くときの向き（#119）

このアプリが決めた規則。ゲームにはない（ゲームは見ている向きで決める）。

- `PL-ORIENT-LINK` 向きの候補は、`axis`（x・y・z）か `facing`（6方向）の値を変えたもの。隣とつながる強さの合計がいちばん大きい候補を選ぶ。強さは、シャフトの口が向き合えば 2、小歯車が同じ軸で軸に垂直な向きに隣り合えば 1。
- `PL-ORIENT-FROM` 3D でクリックした面の側でつながるものは、強さに 4 を足す。
- `PL-ORIENT-KEEP` 同じ強さなら今の向きのまま。つながる相手がなければ変えない。Create のブロックで、`axis` か `facing` を持つものだけを変える。
- `PL-ORIENT-VALID` 置けない向き（上の「置けるか」）は候補から外す。

### 置き方の補助（#123）

ゲームの歯車の置き方の補助（`CogwheelBlockItem` の placement helper。0.5.1 と 6.0 で同じ）。ケース入りでない歯車を置くとき、歯車をクリックしたら使う。

- `PL-HELPER-ORDER` 向きは、ブロックの中心から当たった点へのベクトルに近い順に試す（`IPlacementHelper.orderedByDistance`）。置く位置は空きで、設計図の中で、置ける（上の「置けるか」）こと。
- `PL-HELPER-SMALL` 小歯車で小歯車をクリック：軸に垂直な向きの隣に、同じ軸で置く。
- `PL-HELPER-LARGE` 大歯車で大歯車をクリック：軸の向き（当たった点に近い側）と、軸に垂直な向きを足した斜めに、その垂直な向きの軸で置く。
- `PL-HELPER-MIXED` 大きさが違う：軸に垂直な向きのうち一番近い向きと、それと別の軸の向きを足した斜めに、同じ軸で置く。
- `PL-HELPER-SKIP` 歯車の真ん中の軸（太さ 6 画素の柱）に当たったとき、置くものかクリックしたものが歯車でないとき、置ける位置がないときは使わない（ふつうに面の隣に置く）。

### 足りない状態を補う（#149）

このアプリが決めた規則。ID だけで選んだブロックに、回転軸を決めるプロパティを足す。

- `PL-DEFAULT-FILL` 足すのは `axis=y` か `facing=north`（水平にしか向かないブロックもあるため）。`axis` だけ、`facing` だけ、両方の順に試し、回転軸が決まった最初のものにする。
- `PL-DEFAULT-KEEP` 書いてある値は変えない。回転軸がすでに決まっていれば、そのまま。
- `PL-DEFAULT-PROBLEM` 補っても回転軸が決まらない（`axis=w` のように値が読めない）ときは、状態を変えずに理由を返す。
- `PL-DEFAULT-SCOPE` 補うのは Create の回るブロックだけ。ほかのブロックは知らないブロックとして扱う（null）。
- `PL-BASIC-BLOCKS` 基本の部品（#162）は、どれも上の規則で補った、回転軸の決まった状態にする。

## 例（#30 のテスト）

座標は `[x, y, z]`。テスト用の設計図は `tests/fixtures/` のヘルパーで作る。期待値はこの書類の規則から計算したもの。ゲームで同じ結果になることを確かめたら、この節に「ゲームで確認済み」と書く。

### 例1：水車と大歯車で加速し、プレスを回す

| 位置 | ブロック | 状態 | nbt |
| --- | --- | --- | --- |
| [0,0,0] | `water_wheel` | `facing=south` | `FlowScore: 1` |
| [0,0,1] | `large_cogwheel` | `axis=z` | |
| [1,1,1] | `cogwheel` | `axis=z` | |
| [1,1,2] | `mechanical_press` | `facing=south` | |
| [1,1,3] | `mechanical_press` | `facing=south` | |

- 水車 +8 RPM → 大歯車 +8（シャフト） → 小歯車 −16（大→小、−2） → プレス2台 −16。
- 容量 32 × 8 = 256 SU。応力 8 × 16 × 2 = 256 SU。256 < 256 ではないので **過負荷にならない**。
- [1,1,4] にプレスを1台足すと応力 384 SU で **過負荷**（全部 0 RPM）。

### 例2：速度コントローラー

| 位置 | ブロック | 状態 | nbt |
| --- | --- | --- | --- |
| [0,0,0] | `creative_motor` | `facing=east` | `ScrollValue: 16` |
| [1,0,0] | `shaft` | `axis=x` | |
| [2,0,0] | `rotation_speed_controller` | `axis=x` | `ScrollValue: 64` |
| [2,1,0] | `large_cogwheel` | `axis=z` | |
| [2,1,1] | `crushing_wheel` | `axis=z` | |

- モーター +16、シャフト・コントローラー +16。大歯車と粉砕ホイールは +64。
- 1つのネットワーク。応力 8 × 64 = 512 SU、容量 16384 × 16 = 262,144 SU。

### 例3：向きの衝突

| 位置 | ブロック | 状態 | nbt |
| --- | --- | --- | --- |
| [0,0,0] | `creative_motor` | `facing=east` | `ScrollValue: 16` |
| [1,0,0] | `shaft` | `axis=x` | |
| [2,0,0] | `creative_motor` | `facing=west` | `ScrollValue: 16` |

- 左は +16、右は west 向きなので −16。候補の符号がそろわず **向きの衝突**。右のモーターを `ScrollValue: -16` にすると +16 でそろい、衝突しない。

### 例4：速度の衝突

| 位置 | ブロック | 状態 | nbt |
| --- | --- | --- | --- |
| [0,0,0] | `large_cogwheel` | `axis=z` | |
| [1,1,0] | `cogwheel` | `axis=z` | |
| [0,1,0] | `cogwheel` | `axis=z` | |
| [0,0,1] | `encased_chain_drive` | `axis=z`, `axis_along_first=false`, `part=start` | |
| [0,1,1] | `encased_chain_drive` | `axis=z`, `axis_along_first=false`, `part=end` | |

- 大歯車を k = 1 とすると、[1,1,0] は −2、[0,1,0] は +2（小歯車同士 −1）。チェーンを通ると [0,1,0] は +1。大きさが違うので **速度の衝突**。

### 例5：ギアボックスの向き

| 位置 | ブロック | 状態 | nbt |
| --- | --- | --- | --- |
| [0,0,1] | `creative_motor` | `facing=east` | `ScrollValue: 16` |
| [1,0,1] | `gearbox` | `axis=y` | |
| [2,0,1] | `shaft` | `axis=x` | |
| [1,0,0] | `shaft` | `axis=z` | |
| [1,0,2] | `shaft` | `axis=z` | |

- 東 [2,0,1] は −16、北 [1,0,0] は −16、南 [1,0,2] は +16。

### 例6：蒸気エンジン

`powered_shaft`（`axis=x`）の nbt が `EnginePower: 1.0f`、`Direction: 1`、`EngineType: "create:steam_engine"` のとき、生む回転数 +64、容量 16,384 SU。

## ゲームで確かめる手順

例1〜6 と、残りの未確認事項をゲームで確かめる手順（#110）。Create Astral のクリエイティブのワールド（`設計用`）で行う。結果は、この書類の各節に「ゲームで確認済み（日付）」と書き、未確認事項の印を付ける。

### 準備

1. アプリで Create Astral を Modpack に登録しておく。計算は Modpack の設定（上の「Create Astral の設定」）で行われるので、**期待値はこの書類の初期値ではなく、Create Astral の値で計算したもの**と比べる。アプリはワールドの設定ファイルを使う。ワールドが2つ以上あるときは名前順で先頭（手元では `新規ワールド`）を使うので、確かめるワールドと値が同じかを見ておく（手元の2つは同じ）。
2. ゲームでは、エンジニアのゴーグルを頭に付け、応力計（`stressometer`）と回転計（`speedometer`）を使う。ゴーグルで機械を見ると、回転数と応力が出る。応力計はネットワークの応力と容量を出す。
3. 組んだ機械は、設計図と羽ペン（`schematic_and_quill`）で範囲を選んで保存する（`schematics/` に .nbt ができる）。応力計と回転計は、計算に影響しない（応力 0）ので、置いたまま保存してよい。
4. アプリでその .nbt を開き、プローブで同じブロックの回転数と、ネットワークの応力・容量を読む。ゲームの値と比べる。

### 例ごとの手順

| 確かめること | 組み方 | ゲームで読む値 | Create Astral での期待値 |
| --- | --- | --- | --- |
| 例1（水車・大歯車・プレス） | 例1 の表のとおり。水車の前に水を流す | プレスの回転数、応力計の応力と容量 | 回転数は −16 のまま。容量は 16 × 8 = 128 SU。応力はプレス2台で 256 + 大歯車 0.1 × 8 + 小歯車 0.025 × 16 = 257.2 SU で**過負荷**。プレス1台でも 129.2 SU で過負荷になる（歯車にも応力があるため）。過負荷かどうかと、応力計の応力の値がアプリの合計と一致するかを見る |
| 例2（速度コントローラー） | 例2 の表のとおり。コントローラーの目標を 64 にする | 粉砕ホイールの回転数、応力計 | 粉砕ホイール +64。応力は 粉砕ホイール 12 × 64 = 768 + 大歯車 0.1 × 64 = 6.4 + コントローラー 1 × 16 = 16 + シャフト 0.02 × 16 = 0.32 で、合計 790.72 SU。容量 16,384 × 16 = 262,144 SU |
| 例3（向きの衝突） | 例3 の表のとおり | 回転が止まる（壊れる）か | 衝突。右のモーターを −16 にすると回る |
| 例4（速度の衝突） | 例4 の表のとおり | 回転が止まる（壊れる）か | 衝突 |
| 例5（ギアボックス） | 例5 の表のとおり | 3本のシャフトの回転の向き（ゴーグルの表示か、つないだ回転計の符号） | 東 −16、北 −16、南 +16 |
| 例6（蒸気エンジン） | ボイラー（流体タンク）と蒸気エンジンを組み、効率 100%（ゴーグルの表示）にする | エンジンの軸の回転数と容量 | +64 RPM、容量 16,384 SU |

### 残りの未確認事項の手順

| 確かめること | 手順 |
| --- | --- |
| 1本の `powered_shaft` に蒸気エンジンを2台付けたとき | 同じ軸に2台のエンジンを付けて保存し、ゲームの回転数・容量と、アプリの結果を比べる。設計図の `powered_shaft` の nbt に `EnginePos` がいくつ入るかも見る |
| 速度コントローラーの出力側に、より速い動力源があるとき | 例2 の大歯車の側に、64 より速いクリエイティブモーターをつなぐ。ゲームが衝突にするか、どちらかの回転数になるかを見る |
| ギアボックスの面の係数が、輪になった配置でも一致するか | ギアボックス4つとシャフトで正方形の輪を作り、モーターを1つつなぐ。ゲームで回るか（衝突しないか）と、各シャフトの向きを見る |
| 風車を回したまま保存した設計図に、帆が入るか | 風車の軸受と帆を組み、回してから保存する。設計図の中の帆のブロックと、エンティティ（仕掛け）を、アプリのブロック一覧で見る |
| 色付きのバルブのハンドルの値 | `create-server.toml` の `blue_valve_handle` だけを 100 に変え、ワールドを開き直して、青のハンドルを回したときの容量を応力計で見る。100 × 32 = 3,200 SU なら色ごとの項目を使っている |
| アプリで作った生データ（`id` と `ScrollValue` だけ）を、ゲームが読むか | アプリで新しい設計図にクリエイティブモーターを置き、詳細パネルで回転数を 64 にして書き出す。ゲームで置き（スキーマティキャノンか、クリエイティブの設計図の配置）、モーターが 64 RPM で回るかを見る（#22 と一緒に行う） |

ATM10（1.21.1）の未確認事項（Create の版、`defaultconfigs/` の値、位置の int 配列）は、ATM10 を入れてから同じ手順で確かめる。

## 未確認事項

- [ ] ATM10 に入っている Create の正確な版（読んだソースは 6.0.11）。Create Astral は 0.5.1-f と分かった（上の「対象のバージョンと出典」）。0.5.1-f と、読んだ 0.5.1-i のコードの違い
- [ ] ATM10 が `defaultconfigs/create-server.toml` で応力の値を変えているか（Create Astral は変えている。上の「Create Astral の設定」）
- [ ] 色付きのバルブのハンドルで、ゲームが `copper_valve_handle` と色ごとの項目のどちらを使うか
- [ ] 1.21.1 の設計図で、`Source` などの位置が int 配列で入っているか（実物の .nbt で確認。手元に ATM10 がない）
- [ ] 風車を回したまま保存した設計図に、帆（仕掛けのエンティティ）が入るか
- [ ] 1本の `powered_shaft` に蒸気エンジンを2台付けたときの扱い（コードでは1台分の位置しか持たない）
- [ ] 動かしたとき（#243）のボイラーと風車の回転数・容量が、ゲームで動かしたときと同じか
- [ ] 速度コントローラーの出力側に、より速い動力源があるときの結果
- [ ] 速度コントローラーを出力側の大歯車から回したとき（入力側が設定値で回る。`SpeedControllerBlockEntity.getConveyedSpeed`）。計算はまだこの向きを扱わない（docs/verification.md「見つかったこと」）
- [ ] ギアボックスの面の係数（この書類で順番によらない形に直したもの）が、輪になった配置でもゲームと一致するか
- [ ] 例1〜6 がゲームと同じ結果になるか
- [ ] 回して書き出した設計図を、ゲームで置いたときに Create のブロックが正しくつながるか（上の「回転・反転」）

## 解消した事項

docs/spec.md と docs/design.md の未確認事項のうち、この書類で答えが出たもの。

- Create Astral（Fabric 1.18.2）でも、`create-server.toml` は `saves/<ワールド>/serverconfig/` に作られる（2026-10-25、実物で確認）
- Create Astral は `defaultconfigs/create-server.toml` で応力の値を変えている（上の「Create Astral の設定」）
- 実物の `create-server.toml` の表の見出しは `[kinetics.stressValues.v2.impact]`・`[kinetics.stressValues.v2.capacity]` の形（Create Astral で確認）
- 1.18.2 の設計図では、`Source` などの位置は compound `{X, Y, Z}` で入る（Create Astral の設計図で確認）

- 応力の数値はワールドごとの `serverconfig/create-server.toml`（サーバー設定）に入る。ファイルがなければ、初期値はコードの中（`AllBlocks.java`）にしかない。初期値は上の表のとおり
- ベルトのつながりは、ブロック状態（`facing`・`slope`・`part`）だけで組み立てられる
- クリエイティブモーターの初期値は 16 RPM（`CreativeMotorBlockEntity.DEFAULT_SPEED`）。速度コントローラーも 16
- nbt の項目名は 0.5.1 と 6.0 で同じ。位置の書き方だけが違う

## 参照したソース

1.21.1（`https://github.com/Creators-of-Create/Create/blob/mc1.21.1/dev/src/main/java/com/simibubi/create/` 以下）：

- `content/kinetics/RotationPropagator.java`：つながりと速度比、衝突の判定
- `content/kinetics/KineticNetwork.java`：応力と容量の合計
- `content/kinetics/base/KineticBlockEntity.java`、`GeneratingKineticBlockEntity.java`、`IRotate.java`、`DirectionalShaftHalvesBlockEntity.java`
- `content/kinetics/simpleRelays/`（`CogWheelBlock`、`ICogWheel`、`SimpleKineticBlockEntity`、`encased/EncasedCogwheelBlock`）
- `content/kinetics/gearbox/GearboxBlock.java`、`content/kinetics/transmission/`（`GearshiftBlockEntity`、`ClutchBlockEntity`、`sequencer/`）
- `content/kinetics/chainDrive/`（`ChainDriveBlock`、`ChainGearshiftBlockEntity`）
- `content/kinetics/belt/`（`BeltBlock`、`BeltBlockEntity`、`BeltPart`、`BeltSlope`）
- `content/kinetics/speedController/SpeedControllerBlockEntity.java`
- `content/kinetics/motor/CreativeMotorBlockEntity.java`、`waterwheel/`、`crank/`、`steamEngine/PoweredShaftBlockEntity.java`、`content/contraptions/bearing/WindmillBearingBlockEntity.java`
- 動かしたとき：`content/fluids/tank/`（`BoilerData`、`BoilerHeaters`、`FluidTankBlockEntity`）、`content/kinetics/steamEngine/`（`SteamEngineBlock`、`SteamEngineBlockEntity`）、`content/processing/burner/BlazeBurnerBlock.java`、`content/contraptions/`（`Contraption`、`BlockMovementChecks`、`bearing/BearingContraption`、`glue/SuperGlueEntity`）、`infrastructure/data/CreateRegistrateTags.java`（タグ）
- `content/kinetics/chainConveyor/ChainConveyorBlockEntity.java`
- `infrastructure/config/`（`AllConfigs`、`CServer`、`CKinetics`、`CStress`）、`api/stress/BlockStressValues.java`
- `AllBlocks.java`、`foundation/data/BuilderTransformers.java`
- 回転・反転：`content/contraptions/StructureTransform.java`、`content/schematics/`（`SchematicPrinter`、`SchematicInstances`、`SchematicExport`、`cannon/SchematicannonBlockEntity`）、`content/kinetics/base/DirectionalAxisKineticBlock.java`、`saw/SawBlock.java`、`mechanicalArm/`（`ArmBlockEntity`、`ArmInteractionPoint`）、`content/fluids/tank/FluidTankBlock.java`、`content/redstone/rail/ControllerRailBlock.java`、`content/redstone/displayLink/DisplayLinkBlockEntity.java`、`content/kinetics/crafter/`（0.5.1 は `mc1.20.1/0.5.1` の同じファイル）

1.18.2 Fabric（`https://github.com/Fabricators-of-Create/create/blob/mc1.18/fabric/dev/src/main/java/com/simibubi/create/` 以下）：同じファイルと `content/kinetics/BlockStressDefaults.java`、`foundation/config/ConfigBase.java`。
