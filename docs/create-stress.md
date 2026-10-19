# Create の応力計算の仕様

作成日: 2026-10-19 / Issue: #28 / 使う Issue: #30（`KineticGraph`）/ 設計: [design.md](design.md)

Create の回転（RPM）と応力（SU）の規則を、Create のソースコードから読み取ってまとめる。#30 はこの書類だけで `KineticGraph` と `CreateValueResolver` を作れるようにする。コードは写さず、規則だけを書く。

## 対象のバージョンと出典

| 環境 | Minecraft | Create | 読んだソース |
| --- | --- | --- | --- |
| ATM10 | NeoForge 1.21.1 | 6.0 系 | [Creators-of-Create/Create](https://github.com/Creators-of-Create/Create) の `mc1.21.1/dev`（commit `7ff2760`、`mod_version = 6.0.11`） |
| Create Astral | Fabric 1.18.2 | Create Fabric 0.5.1 系 | [Fabricators-of-Create/create](https://github.com/Fabricators-of-Create/create) の `mc1.18/fabric/dev`（commit `80ecefb`、`mod_version = 0.5.1-i`） |

- 回転の伝わり方（`RotationPropagator`）と応力の合計（`KineticNetwork`）は、2つの版で同じ。違いは書式の細部だけ（下の「バージョンの違い」）。
- 応力の初期値は、2つの版で同じ（`create:chain_conveyor` は 6.0 だけにある）。
- Create のコードは MIT License（1.21.1 版は「The Create Team / The Creators of Create」、1.18 Fabric 版は「2019 simibubi」）。`src/main/resources/assets/` 以下（テクスチャ・モデルなど）は All Rights Reserved なので使わない。数値はコードの中の定数なので、MIT の条件（著作権表示と許諾表示）を README の注記に書けば内蔵してよい。

以下、ソースのパスは `src/main/java/com/simibubi/create/` からの相対パスで書く。

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
- 1.18.2 の Fabric 版も、Forge Config API Port を通して同じ場所・同じ形式で保存する（仮定。Create Astral の実物で未確認）。

`CreateConfig.load(pack)` が探す順番：

1. `defaultconfigs/create-server.toml`
2. `saves/*/serverconfig/create-server.toml`（複数あれば利用者に選んでもらう。1つなら自動で使う）
3. なければ `null`（内蔵の初期値を使う）

### TOML の形

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
- `impact` / `capacity` の表に載るのは Create 本体のブロックだけ（他の Mod のブロックは載せられない作り）。表にないブロックは 0 として扱う（Create と同じ）。
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

| ブロック（`create:`） | impact | 必要回転数 |
| --- | --- | --- |
| `mechanical_press`, `crushing_wheel` | 8 | |
| `mechanical_mixer` | 4 | 中速（30 RPM 以上） |
| `millstone`, `turntable`, `mechanical_drill`, `mechanical_saw`, `deployer`, `mechanical_pump`, `mechanical_bearing`, `clockwork_bearing`, `rope_pulley`, `elevator_pulley`, `hose_pulley`, `mechanical_piston`, `sticky_mechanical_piston`, `copper_backtank`, `netherite_backtank` | 4 | |
| `encased_fan`, `weighted_ejector`, `mechanical_crafter`, `mechanical_arm` | 2 | |
| `cuckoo_clock`, `mysterious_cuckoo_clock`, `chain_conveyor`（6.0 のみ） | 1 | |
| `shaft`, `cogwheel`, `large_cogwheel`, `andesite_encased_shaft`, `brass_encased_shaft`, `andesite_encased_cogwheel`, `brass_encased_cogwheel`, `andesite_encased_large_cogwheel`, `brass_encased_large_cogwheel`, `gearbox`, `clutch`, `gearshift`, `encased_chain_drive`, `adjustable_chain_gearshift`, `belt`, `rotation_speed_controller`, `sequenced_gearshift`, `flywheel`, `gantry_shaft`, `speedometer`, `stressometer`, `display_board` | 0 | `display_board` は中速 |
| 表にないもの（`powered_shaft`, `metal_girder_encased_shaft`, `gantry_carriage` など） | 0 | |

必要回転数は `IRotate.getMinimumRequiredSpeedLevel` を上書きしているもの（`mechanical_mixer`、`display_board`）だけ。足りなくても応力は数える。機械が動かないことを `issues` に出す。

### 供給（capacity、SU/RPM）と生む回転数

| ブロック（`create:`） | capacity | 生む回転数 | 実際の容量（初期値） |
| --- | --- | --- | --- |
| `creative_motor` | 16384 | nbt の設定値（初期値 16、範囲 −256〜256） | 16 RPM で 262,144 SU |
| `water_wheel` | 32 | 8 RPM | 256 SU |
| `large_water_wheel` | 128 | 4 RPM | 512 SU |
| `windmill_bearing` | 512 | 帆の数 ÷ 8（1〜16 RPM） | 512〜8,192 SU |
| `hand_crank` | 8 | 32 RPM（回している間だけ） | 256 SU |
| `copper_valve_handle` と色付きの `*_valve_handle` | 8 | 32 RPM（回している間だけ） | 256 SU |
| `steam_engine`（`powered_shaft` が受け取る） | 1024 | 16 / 32 / 48 / 64 RPM | 効率 1 で 16,384 SU |

- 色付きのハンドルは `copper_valve_handle` の値を使う（`content/kinetics/crank/HandCrankBlockEntity.java` の `getStressConfigKey`）。
- 蒸気エンジンの計算は下の「動力源の回転数」。

## ブロックの回転軸と「軸の口」

`KineticGraph` は、ブロックごとに次の4つを決める。

- **回転軸** `axis`
- **軸の口** `shaftFaces`：シャフトとしてつながる面（`IRotate.hasShaftTowards`）
- **歯車** `cog`：`none` / `small` / `large`（`ICogWheel`）
- **面の係数** `faceFactor`：ギアボックスなど、面ごとに回転が変わるもの（下の節）

ブロック状態のプロパティ名は Minecraft の書き方に合わせる。水平の向き（コードの `HORIZONTAL_FACING`）も、.nbt では `facing` という名前で入る。水平の軸（`HORIZONTAL_AXIS`）は `axis`（値は `x` / `z`）。

`f` = `facing` の向き、`f'` = その反対、`cw(f)` = `f` を上から見て時計回りに 90° 回した向き。

| ブロック | 回転軸 | 軸の口 | 歯車 |
| --- | --- | --- | --- |
| `shaft`, `powered_shaft`, `*_encased_shaft`, `metal_girder_encased_shaft`, `flywheel`, `crushing_wheel`, `clutch`, `gearshift` | `axis` | 軸の両側 | なし |
| `cogwheel` | `axis` | 軸の両側 | 小 |
| `large_cogwheel` | `axis` | 軸の両側 | 大 |
| `*_encased_cogwheel` / `*_encased_large_cogwheel` | `axis` | 軸の正の側は `top_shaft=true` のとき、負の側は `bottom_shaft=true` のとき | 小 / 大 |
| `gearbox` | `axis` | `axis` 以外の4面 | なし |
| `encased_chain_drive`, `adjustable_chain_gearshift` | `axis` | 軸の両側 | なし（チェーンで横につながる） |
| `rotation_speed_controller` | `axis`（x/z） | 軸の両側 | なし |
| `sequenced_gearshift` | `vertical=true` なら y、それ以外は `axis` | 軸の両側 | なし |
| `creative_motor` | `f` の軸 | `f` の面だけ | なし |
| `water_wheel` | `f` の軸 | 軸の両側 | なし |
| `large_water_wheel` | `axis` | 軸の両側 | なし |
| `hand_crank`, `*_valve_handle`, `encased_fan`, `mechanical_drill` | `f` の軸 | `f'` の面だけ | なし |
| `windmill_bearing`, `mechanical_bearing`, `clockwork_bearing` | `f` の軸 | `f'` の面だけ | なし |
| `mechanical_saw` | 水平向きなら `f` の軸、上下向きなら下の「向きと軸」 | 水平向きなら `f'`、上下向きなら軸の両側 | なし |
| `deployer`, `mechanical_piston`, `sticky_mechanical_piston`, `speedometer`, `stressometer` | 下の「向きと軸」 | 軸の両側 | なし |
| `mechanical_press` | `f` の軸 | 軸の両側 | なし |
| `cuckoo_clock`, `mysterious_cuckoo_clock` | `f` の軸 | `f'` の面だけ | なし |
| `weighted_ejector`, `elevator_pulley` | `cw(f)` の軸 | 軸の両側 | なし |
| `hose_pulley` | `cw(f)` の軸 | `cw(f)` の面だけ | なし |
| `rope_pulley` | `axis` | 軸の両側 | なし |
| `gantry_shaft` | `f` の軸 | 軸の両側 | なし |
| `belt` | `slope=sideways` なら y、それ以外は `cw(f)` の軸 | `part` が `middle` 以外のとき軸の両側 | なし |
| `millstone` | y | 下の面だけ | 小 |
| `turntable` | y | 下の面だけ | なし |
| `mechanical_mixer`, `mechanical_arm`, `chain_conveyor`※ | y | なし（※チェーンコンベアは上下の両方） | 小（チェーンコンベアはなし） |
| `mechanical_crafter`, `display_board` | `f` の軸 | なし | 小 |
| `mechanical_pump` | `f` の軸 | なし | 小 |
| `copper_backtank`, `netherite_backtank` | y | 上の面だけ | なし |

**向きと軸**（`DirectionalAxisKineticBlock`、プロパティ `axis_along_first`）：`facing` の軸が x なら `axis_along_first=true` で y、false で z。y なら true で x、false で z。z なら true で x、false で y。

出典：各ブロックの `hasShaftTowards` と `getRotationAxis`（`content/kinetics/**/*Block.java`、`content/contraptions/bearing/BearingBlock.java` など）。

## つながりの規則と速度比

2つのブロック A、B がつながるとき、**速度比** `r(A→B)` を決める。B の回転数 = A の回転数 × r。逆向きは `1 / r`。r が 0 ならつながらない。出典は `content/kinetics/RotationPropagator.java` の `getRotationSpeedModifier`。上から順に判定し、最初に当てはまったものを使う。

調べる相手の位置：

- 6方向の隣
- 小歯車（と斜めのベルト）：回転軸に垂直な面の上の斜め4マス
- 大歯車：斜めの12マス全部（差の2乗の和が 2 の位置）
- ベルト：同じベルトの他の区間（下の「ベルト」）
- チェーンコンベア（6.0）：nbt の `Connections` にある位置

### 1. シャフト同士（軸）

A と B が隣り合い、A の向き d の面と B の反対の面の両方に軸の口があるとき。

`r = faceFactor(A, d) / faceFactor(B, d')`。ふつうのブロックの面の係数は 1 なので r = 1。

### 2. チェーンドライブ同士

`encased_chain_drive` / `adjustable_chain_gearshift` が隣り合い、チェーンでつながっているとき。

- つながる向き（connection axis）：`axis_along_first=true` なら（`axis` が x なら y、それ以外は x）、false なら（`axis` が z なら y、それ以外は z）。
- 両方のつながる向きが同じで、隣の向きがその軸に沿っていること。
- `part` が `start` か `middle` なら正の向きの隣と、`end` か `middle` なら負の向きの隣とつながる。`none` はつながらない。
- `r = m(A) / m(B)`。`m` はチェーンドライブなら 1、可変チェーンギアシフトなら nbt の `Signal`（レッドストーンの強さ）が 0 のとき 1、それ以外は `1 + (Signal + 1) / 16`。

### 3. 大歯車同士

両方が大歯車で、回転軸が違い、差（B − A）が A の軸と B の軸の成分で 0 でなく、残りの成分が 0（直角に組んだ斜め）。

`r = (A の軸の成分 > 0) XOR (B の軸の成分 > 0) ? −1 : 1`

### 4. 大歯車と小歯車

軸が同じで、差の軸の成分が 0、残り2成分の絶対値がどちらも 1（同じ面の斜め）。

- 大 → 小：`r = −2`
- 小 → 大：`r = −0.5`

### 5. 小歯車同士

両方が小歯車で、6方向の隣、回転軸が同じ、隣の向きが回転軸と違う。`r = −1`。

軸の向きに重ねた小歯車は、歯車ではかみ合わない（1. のシャフトとしてつながる）。大歯車同士は軸が同じなら、かみ合わない。

### 6. 速度コントローラー

`rotation_speed_controller` の真上に大歯車があり、大歯車の軸が水平で、コントローラーの `axis` と違うとき。比ではなく、大歯車の回転数を nbt の設定値（`ScrollValue`、初期値 16、範囲 ±256）にする。下の「計算の手順」で別に扱う。

### 7. ベルト

- 同じベルトの区間同士は `r = 1`（同じ `Controller` を持つ区間。`content/kinetics/belt/BeltBlockEntity.java` の `propagateRotationTo`）。
- `part` が `start` / `end` / `pulley` の区間は軸の口を持ち、1. でシャフトとつながる。

**ベルトはブロック状態だけで組み立てられる。** 区間の並びは `BeltBlock.nextSegmentPosition` の規則で決まる。

- `part=start` から始めて、`part=end` まで次の区間に進む。
- 次の区間：`slope=vertical` なら上下に1つ（`facing` が正の向きなら上、負なら下）。それ以外は `facing` の向きに1つ。さらに `slope=upward` なら1つ上、`downward` なら1つ下。
- 途中のブロックがベルトでなければ、そこで切れる。`end` に届く前に設計図の外に出たら、仮定に載せる。

nbt の `Controller`・`Index`・`Length` は確かめに使えるが、必須ではない。`Controller` はワールド座標なので、設計図の中の位置には直せない。

### 8. チェーンコンベア（6.0 のみ）

nbt の `Connections`（相手への相対位置の集合）に入っている相手が `chain_conveyor` なら `r = 1`。相手が設計図の外なら仮定に載せる。

### 9. ガントリー

`gantry_shaft` が `powered=true` で、隣の `gantry_carriage` の `facing` がこちらを向いているとき。キャリッジは仕掛け（contraption）を動かす部品で、応力は 0。最初の版では扱わず、仮定に載せる。

## 面の係数（ギアボックス・ギアシフト・クラッチ）

Create はギアボックスなどの比を「どの面から回転が来たか」で決める（`RotationPropagator.getAxisModifier`、`content/kinetics/transmission/*BlockEntity.java`）。そのままだと伝わる順番に依存するので、順番によらない形に直した。面 e の回転数 = ブロックの内部の値 C × `faceFactor(e)` とする。

### ギアボックス（`gearbox`）

`faceFactor(e) = a(e) × s(e の軸)`

- `a(e)`：e が正の向きなら +1、負なら −1。
- `s`：`axis` 以外の2つの軸を x, y, z の順に並べ、1つ目を +1、2つ目を −1。

例：`axis=y` のギアボックスに西（−x）から +16 が入る。西の面の係数は −1 なので C = −16。東 +1 → −16、北（−z）+1 → −16、南 −1 → +16。Create のコードで計算した結果と一致する（入った面の反対の面は逆回り、横の面は向きによって変わる）。

### ギアシフト（`gearshift`）

`powered=false` なら両面とも 1。`powered=true` なら軸の正の面を 1、負の面を −1（2つの面の比が −1 になればよい）。

### クラッチ（`clutch`）

`powered=false` なら両面とも 1。`powered=true` なら2つの面の間を切る（つながりなし）。クラッチ自身は応力 0 なので、どちらの側に属しても結果は変わらない。

### シーケンスギアシフト（`sequenced_gearshift`）

命令を実行中だけ回転を伝え、待機中は出力側を切る。実行中の状態は時間で変わるので、**待機中（powered=true のクラッチと同じ）とみなし**、仮定に載せる。

## 動力源の回転数

`getGeneratedSpeed` の規則。生む回転数は「その動力源が単独で回すときの回転数」。

| ブロック | 生む回転数 | 値の出どころ |
| --- | --- | --- |
| `creative_motor` | `ScrollValue`（初期値 16）。`facing` が負の向き（down / north / west）なら符号を反転 | nbt → 内蔵 16 |
| `water_wheel` / `large_water_wheel` | `clamp(FlowScore, −1, 1) × 8 / 大きさ`（大きさは小 1、大 2） | nbt の `FlowScore`。ないときは +1 と仮定 |
| `windmill_bearing` | 回っているとき `clamp(帆の数 / 8, 1, 16) × (時計回りなら +1、反時計回りなら −1)` | nbt の `Running` と `LastGenerated`。ないときは 0 とし、仮定に載せる |
| `hand_crank` / `*_valve_handle` | 回している間だけ `(Backwards なら −1、それ以外は +1) × 32`。`facing` が負の向きなら符号を反転 | 回しているとみなし（仮定）、向きは nbt の `Backwards` |
| `powered_shaft`（蒸気エンジン） | `Direction × 16 × k`。k = 効率が 1 以上なら 4、それ以外は `1 + min(2, floor(効率 × 4))` | nbt の `EnginePower`（効率）、`Direction`、`EngineType`。ないときは 0 とし、仮定に載せる |

- 蒸気エンジンの容量（1 RPM あたり）は `効率 × capacity(EngineType) / k`。実際の容量は `効率 × 1024 × 16`（効率 1 で 16,384 SU）。効率はボイラー（流体タンク）の大きさと熱で決まり、最初の版ではタンクから計算しない。
- 風車の帆は、組み立て中は仕掛けのエンティティになる。設計図に帆のブロックがあっても数えない（未確認事項）。

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

1. **ノードを作る。** 設計図の各ブロックを上の表で引く。表にない `create:` のブロックは、回転しないものとして無視する。他の Mod のブロックも無視し、回転に関わりそうなもの（namespace が Create のアドオンのもの）は仮定に載せる。
2. **辺を作る。** 各ノードの調べる相手について「つながりの規則」を判定し、`r ≠ 0` なら辺を足す。A→B と B→A の両方で判定し、どちらかでつながればよい（Create と同じ）。
3. **範囲外を記録する。** 軸の口や歯車の相手の位置が設計図の外のとき、空気とみなし、仮定に `{ pos, message: '範囲外は空気とみなした' }` を足す。その面に `VirtualPort` があれば、それを相手にする。
4. **剛体のまとまりに分ける。** 速度コントローラーのリンク以外の辺で連結成分を作る。これを「まとまり」と呼ぶ。まとまりの中では回転数の比が決まっている。
5. **比を決める。** まとまりの1つのノードを k = 1 とし、辺をたどって各ノードの k を決める（B の k = A の k × r）。すでに k があるノードに別の値が来たら、
   - 符号が違う → **向きの衝突**
   - 大きさが違う（相対誤差 1/65536 を超える）→ **速度の衝突**

   として `issues` に辺の位置を出す。そのまとまりの回転数は 0 とする（ゲームではどれかのブロックが壊れる）。
6. **まとまりの回転数を決める。** まとまりの中の各動力源 s について、まとまりの倍率の候補 `x_s = 生む回転数(s) / k(s)` を求める（0 の動力源は除く）。
   - 候補の符号がそろわない → **向きの衝突**（ゲームではブロックが壊れる）
   - そろう → 絶対値が一番大きい候補を使う（速い動力源が遅い動力源を押し切る）
   - 候補がない → 動力なし（回転数 0）
   - 各ノードの回転数 = x × k
7. **速度コントローラーを解く。** 入力側のまとまりが回っていてコントローラーの回転数が 0 でなく、設定値も 0 でなければ、大歯車のまとまりに「大歯車の回転数 = 設定値」という動力源を足して 6. をやり直す。入力側が止まっていれば、出力側には何も足さない。依存の順番に処理し、コントローラーの輪（出力が入力に戻る）は仮定に載せて打ち切る。
8. **速度の上限。** |回転数| が `maxRotationSpeed` を超えるノードがあれば **速度超過**（ゲームでは壊れる）。
9. **ネットワークに分ける。** まとまりを速度コントローラーのリンクでつないだものが、Create の1つのネットワーク（応力を共有する範囲）。
10. **応力と容量を足す。**
    - 応力 = Σ impact(n) × |回転数(n)|（ネットワークの全ノード）
    - 容量 = Σ capacity(s) × |生む回転数(s)|（ネットワークの全動力源。押し切られた動力源も数える）
11. **判定する。**
    - `disableStress=false` で **容量 < 応力** なら **過負荷**。ゲームではネットワーク全体の回転数が 0 になる。等しいときは過負荷にならない。
    - 回っていて |回転数| < minSpeed の機械は「回転数が足りない」として `issues` に出す。

### 容量の数え方

Create の `KineticNetwork.calculateCapacity` は、動力源の **生む回転数** で容量を数える。ほかの動力源に押し切られて別の速さで回っていても、容量は自分の生む回転数のまま。応力は **実際の回転数**（`getTheoreticalSpeed`、過負荷の前の値）で数える。

### 結果の形

`CalcResult` に次を入れる。

- `summary`：ネットワークごとに「使用 n SU / 供給 m SU」、回転数の範囲。全体の合計。
- `issues`：向きの衝突、速度の衝突、速度超過、過負荷のネットワーク（全ノード）、回転数が足りない機械。
- `assumptions`：範囲外を空気とみなした位置、nbt がなく仮定した動力源、シーケンスギアシフトを待機中とみなしたこと、扱わないブロック。

ノードごとの回転数と応力は、プローブ（#31 など）で使えるように `KineticGraph` から引けるようにする。

## 仮の入出力（VirtualPort）

`pluginId: 'create-stress'` の種類：

| kind | params | 扱い |
| --- | --- | --- |
| `rotation-source` | `rpm`（符号付き）、`capacity`（その回転数での SU） | 面の向こうに動力源を置く。その面のシャフトとして r = 1 でつながる。1 RPM あたりの容量 = capacity / |rpm| |
| `rotation-load` | `stress`（SU。回転数によらない固定値）または `impact`（SU/RPM） | 面の向こうに負荷を置く。r = 1 |

- `rpm` の符号は、つなぐ面の軸の正の向きを基準にする（Create の回転数と同じ）。画面では「時計回り / 反時計回り」でなく「+ / −」と出す。
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

### バージョンの違い

- 項目の名前は 1.18.2（0.5.1）と 1.21.1（6.0）で同じ。
- 位置の書き方が違う。Minecraft 1.20.5 から `NbtUtils.writeBlockPos` が int 配列 `[x, y, z]` を書くようになった。1.18.2 は compound `{X, Y, Z}`。`Source`・`Controller`・`EnginePos` を読むときは両方を受け付ける（`EnginePos` は相対位置なので使える）。
- `chain_conveyor` は 6.0 で追加。1.18.2 には出てこない。

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

## 未確認事項

- [ ] ATM10 と Create Astral に入っている Create の正確な版。読んだソースは 6.0.11 と 0.5.1-i。Modpack の jar の版で確かめる
- [ ] Create Astral（Fabric 1.18.2）で、`create-server.toml` が `saves/<ワールド>/serverconfig/` に作られるか
- [ ] ATM10 と Create Astral が `defaultconfigs/create-server.toml` で応力の値を変えているか
- [ ] 実物の `create-server.toml` で、表の見出しが `[kinetics.stressValues.v2.impact]` の形になっているか（コードの組み立て方から読んだもの）
- [ ] 1.21.1 の設計図で、`Source` などの位置が int 配列で入っているか（実物の .nbt で確認）
- [ ] 風車を回したまま保存した設計図に、帆（仕掛けのエンティティ）が入るか
- [ ] 1本の `powered_shaft` に蒸気エンジンを2台付けたときの扱い（コードでは1台分の位置しか持たない）
- [ ] 速度コントローラーの出力側に、より速い動力源があるときの結果
- [ ] ギアボックスの面の係数（この書類で順番によらない形に直したもの）が、輪になった配置でもゲームと一致するか
- [ ] 例1〜6 がゲームと同じ結果になるか

## 解消した事項

docs/spec.md と docs/design.md の未確認事項のうち、この書類で答えが出たもの。

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
- `content/kinetics/chainConveyor/ChainConveyorBlockEntity.java`
- `infrastructure/config/`（`AllConfigs`、`CServer`、`CKinetics`、`CStress`）、`api/stress/BlockStressValues.java`
- `AllBlocks.java`、`foundation/data/BuilderTransformers.java`

1.18.2 Fabric（`https://github.com/Fabricators-of-Create/create/blob/mc1.18/fabric/dev/src/main/java/com/simibubi/create/` 以下）：同じファイルと `content/kinetics/BlockStressDefaults.java`、`foundation/config/ConfigBase.java`。
