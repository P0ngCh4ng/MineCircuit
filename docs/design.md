# MineCircuit クラス設計

作成日: 2026-10-19 / 更新: 2026-10-22（デスクトップ版を追加） / 仕様: [spec.md](spec.md)

TypeScriptで書く。コード例は設計を示すためのもので、細部は実装時に決める。

## 基本方針

1. **設計図ファイル1つだけで動く。** Modpack、設定ファイル、計算プラグインは、あればできることが増えるだけで、なくても動く。どの型でも `Modpack | null` のように「ない場合」を扱う。
2. **ファイルにあるものは全部、失わずに持つ。** 解釈できない項目も捨てない。後で使えるようにするためと、将来ファイルに書き戻すときに壊さないため。
3. **読み込みと解釈を分ける。** `Blueprint` / `BlockVolume` は「ファイルに何が入っているか」だけを表す。Modごとの意味づけ（回転のつながりなど）は計算プラグインの中で作る。
4. **値には出どころを付ける。** 計算に使った値が、設計図・Modpack・内蔵の初期値・仮定・仮の入出力のどれから来たかを記録し、結果に表示する。
5. **分からないものは「分からない」と扱う。** 推測で埋めた値は仮定として記録する。
6. **設計図の変更は、編集の操作を通してだけ行う。** 画面や計算プラグインが `BlockVolume` を直接書き換えない。こうすると、すべての変更が元に戻せる。

## 層と依存の向き

依存は上から下への一方向だけ。下の層は上の層を知らない。

```mermaid
flowchart TB
    view["view<br/>Vue 3 + Three.js"]
    edit["edit<br/>編集の操作と履歴"]
    analysis["analysis<br/>集計・検索・計測"]
    calc["calc<br/>計算プラグイン"]
    io["io<br/>ファイルの読み込み・書き出し"]
    domain["domain<br/>データの型"]
    view --> edit
    view --> analysis
    view --> calc
    view --> io
    edit --> domain
    analysis --> domain
    calc --> domain
    io --> domain
```

## domain：データの型

### ResourceLocation / BlockState

```ts
// "create:shaft" を namespace と path に分けて持つ
class ResourceLocation {
  constructor(readonly namespace: string, readonly path: string) {}
  static parse(s: string): ResourceLocation
  toString(): string
}

class BlockState {
  constructor(
    readonly id: ResourceLocation,
    readonly properties: Readonly<Record<string, string>>, // axis=y, facing=north など
  ) {}
}
```

### Blueprint

設計図ファイル1つ分。ファイルの情報と中身を持つ。

```ts
class Blueprint {
  constructor(
    readonly name: string,                       // ファイル名
    readonly format: 'nbt' | 'schem' | 'litematic',
    readonly dataVersion: number,                // Minecraftのバージョン判定に使う。2975 = 1.18.2
    readonly regions: BlockVolume[],             // .nbt と .schem は1つ、.litematic は複数ありうる
    readonly meta: BlueprintMeta,                // 作者・説明など。ない形式は空
  ) {}

  get size(): Vec3                               // 全リージョンを合わせた大きさ
  get namespaces(): Set<string>                  // 足りないModの検出に使う
  get(pos: Vec3): BlockState | null              // 設計図全体の座標で引く
  blockEntityAt(pos: Vec3): RawNbt | null
  neighbor(pos: Vec3, dir: Direction): BlockState | null  // 範囲外は null
  forEachInLayer(y: number, fn: (pos: Vec3, state: BlockState) => void): void
}

interface BlueprintMeta {
  author?: string
  description?: string
  createdAt?: Date
}
```

- 座標は設計図全体のもので、y が上下（段）。Minecraftと同じ。
- リージョンは最初から配列にする。今は `.nbt` だけで常に1つだが、単数で作ると `.litematic` 対応時に利用箇所を全部直すことになる。

### BlockVolume

1つのリージョンのブロック配置。読み込んだものを全部持つ。

```ts
class BlockVolume {
  readonly name: string                          // リージョン名。.nbt なら "main"
  readonly offset: Vec3                          // 設計図全体の中での位置
  readonly size: Vec3
  readonly palette: BlockState[]
  private readonly cells: Int32Array             // 位置ごとのパレット番号。空気は -1
  private readonly blockEntities: Map<number, RawNbt>  // セル番号 → ブロックエンティティの生データ
  readonly entities: RawEntity[]                 // 額縁、防具立てなど。生データのまま
  readonly extra: RawNbt                         // 解釈していない一番上の階層の項目
  readonly alternatePalettes: RawNbt[][]         // palettes 形式の .nbt で、先頭より後ろのパレット（生データ）

  get(x: number, y: number, z: number): BlockState | null
  blockEntityAt(x: number, y: number, z: number): RawNbt | null

  // 編集用。呼ぶのは edit 層の操作だけ
  setCell(x: number, y: number, z: number, cell: CellValue): void
  cellAt(x: number, y: number, z: number): CellValue
  stateIndex(state: BlockState): number   // パレットになければ足す
}

// 1マス分の中身。空きは state = null
interface CellValue {
  state: BlockState | null
  blockEntity: RawNbt | null
}
```

- `cells` を型付き配列にするのは、数万ブロックの設計図でもメモリと速度を抑えるため。
- 編集でパレットに使われない状態が残っても、そのままにする。書き出し時に使っている状態だけでパレットを作り直す。
- ブロックエンティティとエンティティは生データ（`RawNbt`）のまま持つ。中身の解釈は、必要になったModごとにプラグインで行う。
- `extra` には `Railways_DataVersion` のような、Modが足した知らない項目をそのまま入れる。形式で決まった項目（.nbt なら `size`・`palette`・`palettes`・`blocks`・`entities`・`DataVersion`）は入れない。
- `palettes` 形式（パレットのリスト）の .nbt は先頭のパレットを使う。残りは `alternatePalettes` に生データのまま持ち、書き出しで戻す。並びは `palette` と同じ番号なので、編集で足した状態（末尾に足される）以外はそのまま対応する。

## io：読み込み

### FileSource

ファイルの読み方をここに閉じ込める。Tauriでデスクトップ版にするときは、ここだけ差し替える。

```ts
interface FileSource {
  list(dir: string): Promise<string[]>
  read(path: string): Promise<ArrayBuffer>
  stat?(path: string): Promise<{ size: number; lastModified: number } | null>   // 変わった jar だけ読み直すため。なくてもよい
  readRange?(path: string, start: number, end: number): Promise<ArrayBuffer>    // ファイルの一部だけ。jar の必要な部分だけを読むため。なくてもよい
}

// 保存先。ブラウザでは保存先を選ぶ画面、Tauri版ではファイルに直接書く
interface FileSink {
  save(suggestedName: string, data: Uint8Array): Promise<'saved' | 'cancelled'>
}

class BrowserFileSource implements FileSource { /* File System Access API */ }
class BrowserFileSink implements FileSink { /* showSaveFilePicker */ }
class TauriFileSource implements FileSource { /* @tauri-apps/plugin-fs。デスクトップ版。readRange は open + seek + read */ }
class TauriFileSink implements FileSink { /* @tauri-apps/plugin-dialog の save + plugin-fs の writeFile */ }
```

#### デスクトップ版（Tauri）

デスクトップ版は、ブラウザ版の画面をそのまま Tauri 2 で包む。違うのはファイルの読み書きだけで、`FileSource` / `FileSink` とその周り（Modpack の登録、設計図を開く・保存する）を差し替える。

| 部分 | ブラウザ版 | デスクトップ版 |
| --- | --- | --- |
| Modpack のフォルダ | `BrowserFileSource`（フォルダのハンドル） | `TauriFileSource`（フォルダのパス） |
| 登録の保存 | IndexedDB にハンドルを保存。許可が切れたら出し直す | IndexedDB にパスを保存。次回も許可なしで読む |
| 設計図を開く | `<input type="file">` とドラッグ&ドロップ | ファイルを選ぶ画面は Tauri のダイアログ（`pickTauriBlueprintFile`）。ドラッグ&ドロップは同じ |
| 保存 | `BrowserFileSink`（保存先を選ぶ画面。なければダウンロード） | `TauriFileSink`（保存先を選ぶ画面で選んだパスに書く） |
| 表示名の保存 | IndexedDB | 同じ（WebView2 の IndexedDB） |

- **どちらで動いているかの判定は view の1か所だけ**（`view/platform/`）で行い、そこで実装を選んでストアに渡す。io・edit・analysis・calc は、どちらで動いているかを知らない。実装を選ぶ関数は `view/platform/fileAccess.ts`（`createBlueprintSink`、`loadDesktopModpackFolders`、`pickDesktopBlueprintFile`、画面の注意書きの `fileHandlingNotice`）。io/tauri/ はここから動的 import で読む。
- **`TauriFileSource` などは `src/io/tauri/` に置く。** Tauri の API（`@tauri-apps/*`）を import してよいのは、`src/io/tauri/` と `view/platform/` だけにする。ブラウザ版のビルドにも入るが、動的 import で読み、ブラウザでは呼ばない。Lint の決まりに足す。
- **Modpack の登録**は、今の `ModpackRegistry<H>` のハンドルの型 `H` をパス（`string`）にして使う（`io/tauri/tauriModpackRegistry.ts`）。`ModpackHandleOpener` の実装を Tauri 用に足すだけで、登録の一覧や画面は変えない。保存先は `IndexedDbModpackStore<H>`（`io/modpack/indexedDbModpackStore.ts`）で、ブラウザ版（`minecircuit-modpacks`）と名前を分けて `minecircuit-modpacks-desktop` に入れる。
  - 開くときは、まずフォルダの一覧を読んで確かめる。読む許可の範囲の外（persisted-scope の記録が消えた、など）なら `needs-permission` にし、「フォルダを読む許可を出す」で同じフォルダを選び直してもらう（選ぶと Tauri が範囲を足し直す）。別のフォルダを選んだら開かない。フォルダが消えていれば、そのパスを書いたエラーにする。
- **読む許可の範囲**：Tauri の fs プラグインは、許可した場所しか読めない。利用者がダイアログで選んだフォルダだけを許可し、`tauri-plugin-persisted-scope` で次回も同じ範囲を許可する。読み込みは選んだフォルダの中だけ、書き込みは保存の画面で選んだファイルだけにする。
- **jar の読み方**：`FileSource` の任意の `readRange?(path, start, end)` と `stat` の両方があれば、zip の末尾（ファイルの一覧）と必要な項目だけを読む（`io/modpack/partialZip.ts`。下の「Modpack / ModpackLoader」）。`TauriFileSource`（open + seek + read）、`BrowserFileSource` と `<input webkitdirectory>` のファイル（どちらも `File.slice`）が持つ。どちらでも結果は丸ごと読んだときと同じ。
- **Rust 側**（`src-tauri/`）には、Tauri の起動と、公式プラグイン（fs、dialog、persisted-scope）の登録と、許可（capabilities）の設定だけを書く。独自のコマンドは作らない。処理を Rust に書くと、ブラウザ版と動きがずれ、Vitest でテストできなくなるため。
- **許可しない操作**：ネットワーク、シェル、自動更新。CSP でも外部への通信を止める。

許可の一覧（`src-tauri/capabilities/default.json`。メインウィンドウだけ）:

| 許可 | 使いみち |
| --- | --- |
| `core:default` | Tauri の基本（ウィンドウ・イベント・パスなどの読み取り）。通信やファイルの許可は含まない |
| `dialog:allow-open`・`dialog:allow-save` | ファイル・フォルダを選ぶ画面と、保存先を選ぶ画面。メッセージの画面は使わない |
| `fs:allow-read-file`・`fs:allow-read-dir`・`fs:allow-stat`・`fs:allow-exists` | 選んだフォルダ（Modpack）と選んだファイルを読む |
| `fs:allow-open`・`fs:allow-read`・`fs:allow-seek` | jar の一部だけを読む（開く・位置を移す・読む）。開くのは読むためだけ（`read: true`）。閉じるのは `core:default` に入っている |
| `fs:allow-write-file` | 保存の画面で選んだファイルに書く |

- fs の許可には固定の範囲（`$HOME` など）を付けない。範囲は、dialog プラグインが利用者の選んだパスを実行中に足すものだけになる。フォルダを選ぶときは `recursive: true` を渡して中まで読めるようにし、persisted-scope がその範囲を次回も残す。
- fs の範囲は読み書きで分かれていないので、選んだフォルダにも書けてしまう。書き込みは `TauriFileSink` が保存の画面で選んだパスにだけ行う、とコードで守る。
- CSP（`src-tauri/tauri.conf.json`）は、自分のファイル（`'self'`）と Tauri の内部の通信（`ipc:`・`http://ipc.localhost`）と `blob:`・`data:` だけを許す。外部の URL への通信・読み込みはすべて止まる。Vue の静的な部分が `style` 属性を使うため、`style-src` だけ `'unsafe-inline'` を許し、Tauri がそこに nonce を足さないようにしている（`dangerousDisableAssetCspModification`）。開発中（`devCsp`）は Vite の更新通知（`ws://localhost:5173`）も許す。
- ウィンドウのドラッグ&ドロップは Tauri ではなくページに渡す（`dragDropEnabled: false`）。ブラウザ版と同じ方法で設計図を開けるようにするため。

### BlueprintReader

設計図の形式ごとに1クラス。最初は `.nbt` だけ。

```ts
interface BlueprintReader {
  canRead(fileName: string): boolean
  read(name: string, data: ArrayBuffer | Uint8Array): Promise<Blueprint>   // gzip の展開が非同期のため
}

class NbtBlueprintReader implements BlueprintReader {}
// 後で: SchemBlueprintReader, LitematicBlueprintReader
```

.nbt の読み込みの規則:

- 空気（`minecraft:air`・`cave_air`・`void_air`）は置かれていないもの（-1）にする。パレットには残すので、パレット番号はファイルと同じになる。Create の設計図は空気を保存しない（`blocks` に入らない）ので、これで失うものはない。バニラの構造ブロックの .nbt は空気を明示して保存するが、その区別（空気で上書きするか、そのままにするか）は残らない
- `DataVersion` がないファイルは `dataVersion = 0`（`UNKNOWN_DATA_VERSION`）にする。書き出しでは 0 なら `DataVersion` を書かない
- 形式が違うときは、何が足りないか・どこが違うかを書いた `BlueprintReadError` を出す

### BlueprintWriter

読み込みの逆。形式ごとに1クラス。最初は `.nbt` だけ。

```ts
interface BlueprintWriter {
  readonly format: 'nbt' | 'schem' | 'litematic'
  write(bp: Blueprint): Promise<Uint8Array>   // gzip 済み
}

class NbtBlueprintWriter implements BlueprintWriter {}
```

書き出しの規則:

- 一番上の階層は、読み込んだときの生データ（`extra`）を元にする。`size`・`palette`・`blocks` だけを作り直し、`entities`・`DataVersion`・Modが足した項目はそのまま残す
- パレットは、使っている状態だけで作り直す
- 既存ブロックの生データ（nbt）はそのまま書く。新しく置いたブロックには書かない
- 書き出した直後に読み直し、ブロックの配置と状態が元と一致するか確かめる。一致しなければ保存しない
- 新規作成の設計図は `DataVersion` を持たないので、対象のModpackのバージョンから決める。Modpackがなければ利用者に選んでもらう
  - 新規作成の画面で Minecraft のバージョンを選び、その正式版の `DataVersion` を設計図に入れる（`domain/minecraftVersion.ts` の一覧）。書き出しではそれを書く
  - Modpack があれば、jar の名前と Mod のバージョンに一番多く出てくる Minecraft のバージョンを最初に選んでおく（`io/modpack/minecraftVersionGuess.ts`）。jar にはバージョンを確実に書いた場所がないため推定にとどめ、利用者が選び直せる
  - `DataVersion` のない .nbt はゲームが古い版のデータとして変換しようとするので、新規作成ではバージョンを選ぶまで作らない

### Modpack / ModpackLoader

```ts
class ModpackLoader {
  constructor(private source: FileSource) {}
  load(): Promise<Modpack>   // mods/*.jar を開き、Mod情報と表示名を集める。resourcepacks/ と ModTranslations/ の翻訳も重ねる
}

class Modpack {
  readonly mods: ModInfo[]                                  // modId, 名前, バージョン
  hasNamespace(ns: string): boolean                         // jar の assets/ 以下のフォルダ名で判定
  displayName(id: ResourceLocation, lang: 'ja_jp' | 'en_us'): string | null
  config(path: string): Promise<string | null>              // 設定ファイルの中身。なければ null
  blockStateDefinition(id: ResourceLocation): JsonValue | null   // blockstates/<path>.json。回転の候補に使う
  blockIds(): string[]                                      // blockstates のあるブロックの ID（名前順）。置くブロックの検索に使う
  assets(): AssetReader                                     // 見た目の資産（models・blockstates・textures）を読む。下の「見た目」
  readonly vanilla: VanillaStatus | null                    // Minecraft 本体の jar を見つけたか。下の「Minecraft 本体の資産」
}
```

- namespace と modId は一致しないModがあるため、`hasNamespace` は jar の `assets/<namespace>/` で判定する。KubeJS のスクリプトで登録したブロックの namespace も足す（下の「KubeJS が足すブロック」）。
- jar から読むのは翻訳ファイル・モデル・ブロック状態の定義・テクスチャだけ。Javaのコードは実行しない。
- 読み込んだ表示名の一覧はアプリ内（IndexedDB）に保存し、2回目以降を速くする。jar ごとに、ファイル名・大きさ・更新時刻を鍵にして IndexedDB に保存し、変わった jar だけ読み直す。
- jar を開く処理（zip の展開と JSON の解釈）は Web Worker で行う。`ModpackLoader` は開く関数を差し替えられるので、テストでは Worker なしで動く。
- jar の必要な部分だけを読む（`FileSource` に `readRange` と `stat` があるとき。`io/modpack/partialZip.ts`）：
  - 末尾の 64KB ほど（ファイルの一覧の場所を書いた目印と zip64 の目印）→ ファイルの一覧 → 欲しい項目（Mod の情報、翻訳、ブロック状態の定義、jar の中の jar）の順に、その範囲だけを読む。項目は並んで入っているので、項目の終わりは次の項目の始まりで決める。間が 64KB 以下の項目はまとめて1回で読み、読む回数を減らす。
  - ファイルを読むのは画面側（Tauri のファイルの読み書きは Worker から呼べない）。読んだものは圧縮されたまま（`ExtractedZip`：すべての項目の名前と、欲しい項目の圧縮されたバイト列）Worker へ移し（コピーしない）、Worker で展開と JSON の解釈を行う。Worker へ渡すものは `JarContent`（ファイル全体の `zip` か、取り出した `entries`）。
  - 結果は fflate の `unzipSync` で丸ごと読んだときと同じになるよう、fflate と同じ読み方をする（zip64、名前の文字コード、末尾のコメントを含む）。想定と違う形（zip でない、zip の前に余計なデータがある、読めたバイト数が足りない、など）なら、丸ごと読む方法に戻す。壊れた jar のお知らせは、丸ごと読んだときと同じ文になる。
  - 保存の鍵（大きさと更新時刻）と IndexedDB への保存は、丸ごと読むときと同じ。
- `minecraft` の namespace は jar になくても、常にあるとみなす。本体の翻訳・ブロック状態の定義・資産は、Minecraft 本体の jar を見つけたときだけ読む（下の「Minecraft 本体の資産」）。見つからなければ、リソースパックが足していない限り本体のブロックの表示名は出ない。

#### Minecraft 本体の資産

バニラ（`minecraft:`）のブロックは mods/ にないので、Minecraft 本体の jar（クライアントの jar）を読む（`io/modpack/vanillaAssets.ts`）。本体の jar はアプリにもリポジトリにも入れず、利用者の PC にあるものをその場で読む。

本体の jar は、ランチャーごとに置き場所が違い、多くは Modpack のフォルダの外にある。ここでは versions/・libraries/・assets/ のあるフォルダを「ゲームのフォルダ」と呼ぶ。

| ランチャー | Modpack のフォルダ | ゲームのフォルダ | 本体の jar | 資産の索引の id |
| --- | --- | --- | --- | --- |
| 公式ランチャー | `.minecraft`（起動の構成でゲームのフォルダを分けたときはそのフォルダ） | `.minecraft` | `versions/<版>/<版>.jar` | `versions/<版>/<版>.json` の `assetIndex.id` |
| CurseForge | `curseforge/minecraft/Instances/<名前>` | `curseforge/minecraft/Install`（すべてのプロファイルで共有） | 同上 | 同上 |
| Modrinth App | `ModrinthApp/profiles/<名前>` | `ModrinthApp/meta` | 同上。Mod ローダーを使う版は `versions/<版>-<ローダー>/<同じ名前>.jar` | 同上 |
| Prism Launcher / MultiMC | `instances/<名前>/.minecraft` | ランチャーのフォルダ | `libraries/com/mojang/minecraft/<版>/minecraft-<版>-client.jar` | `meta/net.minecraft/<版>.json` の `assetIndex.id` |

- **版を決める。** Modpack のフォルダのランチャーの情報（CurseForge の `minecraftinstance.json` の `gameVersion`、Modrinth App の古い `profile.json` の `metadata.game_version`）→ Mod の jar の名前とバージョンからの推定（`minecraftVersionGuess.ts`）の順。どちらでも分からなければ、ゲームのフォルダにある版が1つだけのときにそれを使う。
- **探す順。** Modpack のフォルダ（公式ランチャーで `.minecraft` を選んだとき）→ 利用者が選んだゲームのフォルダ（選んだ順）。各フォルダで、上の表の jar の場所と、フォルダの一番上の `<版>.jar`・`minecraft-<版>-client.jar`（版のフォルダそのものを選んだとき）を探す。FileSource は選んだフォルダの外を読めないので、Modpack のフォルダから `../../Install` のようにたどることはしない。
- **ゲームのフォルダを選んでもらう。** 見つからなければ、Modpack の画面に「Minecraft 本体のフォルダを選ぶ」を出す。選んだフォルダは Modpack の登録と同じ方法で保存する（ブラウザ版はフォルダのハンドルを IndexedDB の `minecircuit-game-folders`、デスクトップ版はパスを `minecircuit-game-folders-desktop`。`io/modpack/gameFolderRegistry.ts`）。1つのフォルダをすべての Modpack で使う。versions/・libraries/・assets/ も jar もないフォルダは足さない。ブラウザ版で許可が切れていたら「本体のフォルダを読む許可を出す」で出し直す。デスクトップ版は選んだときに読む範囲が足され、persisted-scope が次回も残す（許可の設定は変えない）。
- **読み方。** 本体の jar は Mod の jar と同じ読み方（部分読み、Worker の `scanJar`、IndexedDB の保存。鍵は `minecraft|<jar のパス>` と大きさ・更新時刻）。見た目の資産を持たない jar（中身の違うもの）は使わず、次の場所を探す。読めない jar は `Modpack.problems` に書いて次の場所を探す。見つからなくてもエラーにはせず、本体のブロックを色付きの箱で描き、名前を出さない。
- **優先度。** 本体の翻訳・ブロック状態の定義・資産は、どの jar よりも優先度が低い（Mod やリソースパックが本体のテクスチャを差し替えていれば、そちらを使う）。Mod の一覧・namespace・jar の数には足さない。`hasNamespace('minecraft')` はこれまでどおり常に true。ブロック状態の定義を足すので、置くブロックの検索（`blockIds()`）にも本体のブロックが出る。
- **日本語の名前。** 本体の jar の翻訳は `en_us.json` だけで、ほかの言語はランチャーが資産としてダウンロードし、ハッシュの名前で置く。ゲームのフォルダの `assets/indexes/<id>.json`（id は上の表。版の情報がなければ `<版>.json`・`<1.xx>.json` を試す）の `objects["minecraft/lang/ja_jp.json"].hash` から、`assets/objects/<ハッシュの先頭2文字>/<ハッシュ>` を読む。中身はハッシュで決まるので、ハッシュを鍵にして名前だけを IndexedDB に保存する。ランチャーは索引にある資産（全言語の翻訳を含む）をまとめてダウンロードするので、日本語を選んだことがなくても多くはある。なければ英語の名前だけになり、画面にそう書く。1.12 以前の `.lang` 形式の翻訳は読まない。
- 画面（`view/VanillaAssetsStatus.vue`、`view/stores/gameFolders.ts`）は、見つけた版と場所、日本語の名前を読めたか、選んだフォルダの一覧を出す。選んだフォルダが変わると、Modpack を読み直す。

#### jar の外の翻訳

Modpack によっては、jar の外で Mod の翻訳を足している。`ModpackLoader` は jar のあとに次の場所も読み、`assets/<namespace>/lang/` の `ja_jp.json` と `en_us.json`（大文字小文字は問わない）から名前のキーだけを取り出す（`io/modpack/langPacks.ts`）。

| 場所 | 形 |
| --- | --- |
| `resourcepacks/*.zip` | zip のリソースパック |
| `resourcepacks/<フォルダ>/` | フォルダのリソースパック |
| `ModTranslations/` | `assets/<namespace>/lang/` を持つフォルダ（pack.mcmeta はない） |
| `kubejs/` | `kubejs/assets/<namespace>/` を持つフォルダ（KubeJS が足したブロックの翻訳と資産。下の「KubeJS が足すブロック」） |

- 同じキーがあれば、優先度の高いものを使う。低い順に、jar（名前順） < `kubejs/` < `ModTranslations/` < `resourcepacks/` のうち `options.txt` に書いていないもの（名前順） < `options.txt` の `resourcePacks` に書いてあるもの（書いてある順。後ろほど優先。ゲームと同じ）。
- `options.txt` で有効になっていないパックも読む。Modpack が別の Mod（Global Packs など）でパックを有効にしていることがあり、どれが有効かを確実には決められないため。表示名にだけ使うので、外れても困ることは少ない。
- 表示名の言語の順（日本語 → 英語）はこれまでどおり。リソースパックの英語名が jar の日本語名に勝つことはない。
- リソースパックは Mod ではないので、`hasNamespace`・ブロック状態の定義・Mod の一覧には足さない。
- zip のリソースパックは jar と同じ読み方（Worker の `scanJar`、IndexedDB の保存）を使う。保存の鍵はパス（`resourcepacks/foo.zip`）にして jar と分け、保存する前に翻訳以外を捨てる。フォルダは翻訳ファイルだけを直接読む（数が少ないので保存しない）。
- 読めないパックや翻訳ファイルは `Modpack.problems` に入れ、ほかは読み続ける。翻訳を読んだ場所の一覧は `Modpack.langPacks`。

#### KubeJS が足すブロック

Modpack によっては、jar ではなく KubeJS のスクリプトでブロックを登録している（Create Astral の `createastral:` など）。jar の `assets/` にない namespace なので、そのままでは足りない Mod と判定してしまう（`io/modpack/kubejs.ts`）。

- `kubejs/startup_scripts/` の `.js`（下のフォルダも含む）から、`.create("<namespace>:<path>")` の形の呼び出しを探し、その namespace を `hasNamespace` と `Modpack.namespaces` に足す。スクリプトは実行しない。namespace のない ID（`kubejs:` になる）は数えない（KubeJS の jar が `kubejs` を持つ）。
- 文字列で探すだけなので、変数で組み立てた ID は拾えない。また、スクリプトが既存の Mod の namespace（`create:` など）で登録していれば、その Mod の jar がなくても「ある」とみなす。
- `kubejs/assets/` は、フォルダのリソースパックと同じく翻訳と見た目の資産を読む（上の「jar の外の翻訳」）。KubeJS はブロック状態の定義をゲームの中で作るので、`kubejs/assets/` に `blockstates/` がないことが多い。そのときは、ほかの Mod の資産のないブロックと同じく色付きの箱で描く。

## analysis：集計と検索

```ts
class BlueprintStats {
  constructor(private bp: Blueprint) {}
  countAll(): Map<string, number>              // ID ごとの数。properties は区別しない。多い順
  countLayer(y: number): Map<string, number>
  bounds(): { min: Vec3; max: Vec3 } | null    // ブロックのある範囲。1つもなければ null
  totals(): BlueprintTotals                    // ブロック数、種類、nbt 付き、エンティティ（上のバー）
}

class MissingModDetector {
  detect(bp: Blueprint, pack: Modpack): string[]   // 足りない namespace の一覧
}

class BlockSearch {
  find(bp: Blueprint, id: ResourceLocation): Vec3[]
}
```

## analysis：計測

```ts
interface Measurement {
  a: Vec3
  b: Vec3
  delta: Vec3                 // b - a
  euclidean: number           // 直線距離
  manhattan: number           // 軸に沿った距離。シャフトやベルトを引く長さの目安
  boundingSize: Vec3          // 2点を囲む範囲
}

function measure(a: Vec3, b: Vec3): Measurement
function floodSameState(bp: Blueprint, start: Vec3): Vec3[]   // 隣り合う同じ種類のブロック
```

`floodSameState` は「つながり」ツールで使う。回転や配管のつながりではないので、画面にもそう書く。本当のつながりは計算プラグインが作る（`KineticGraph` など）。

## edit：編集の操作と履歴

### 操作

すべての変更を操作（コマンド）として表す。操作は「どのマスが、何から何に変わったか」の一覧を持つので、元に戻すのもやり直すのも同じ形で扱える。

```ts
interface CellChange {
  pos: Vec3
  before: CellValue
  after: CellValue
}

interface EditCommand {
  readonly label: string              // 「shaft を置く」。元に戻すボタンのツールチップに出す
  readonly changes: CellChange[]
}

// 操作を作る関数。Blueprint は変えず、変更の一覧だけを返す
function placeBlock(bp: Blueprint, pos: Vec3, state: BlockState, replace: boolean): EditCommand | null
function eraseBlock(bp: Blueprint, pos: Vec3): EditCommand | null
function rotateBlock(bp: Blueprint, pos: Vec3, vertical: boolean): EditCommand | null
// 生データの項目 key を tag にする。生データがなければ initial の写しから作る
function setBlockEntityTag(bp: Blueprint, pos: Vec3, key: string, tag: NbtTag, initial: RawNbt | null, label: string | null): EditCommand | null
// 後で: fillRegion, copyRegion, rotateRegion, resizeBlueprint
```

- 新しく置いたブロックは `blockEntity: null`。計算では値の出どころの仕組みで初期値を使う
- 回転では生データ（nbt）をそのまま引き継ぐ
- 生データの項目を変える操作は、元の生データを書き換えず、写しを作って項目だけを差し替える。元に戻すと元の生データ（同じもの）を書き戻す。どのブロックのどの項目を変えられるか、生データがないときに何を入れるかは、Mod ごとの知識なので calc に置く（`calc/blockSettings.ts` の `blockSettingsFor`）。画面はそれを表示するだけ
- 範囲の外への配置は、範囲の拡張（`resizeBlueprint`）を作るまでは受け付けない

### 履歴

```ts
class EditHistory {
  constructor(private bp: Blueprint) {}
  apply(cmd: EditCommand): void    // after を書き込み、undo に積む。redo は空にする
  undo(): EditCommand | null       // before を書き戻す
  redo(): EditCommand | null
  get canUndo(): boolean
  get canRedo(): boolean
  get count(): number              // 画面の「編集 n 回」
  readonly onChange: Signal<void>  // 画面・集計・計算の再実行の合図
}
```

変更のたびに、集計（ブロック数）、3D表示、計算を更新する。計算は変更が続く間は待ち、止まってから Web Worker で走らせる。

### 置くブロック（ブラシ）

```ts
class BlockBrush {
  state: BlockState
  rotate(vertical: boolean): boolean   // R / Shift+R。回せる向きがなければ false
  static fromBlock(state: BlockState, modpack: Modpack | null): BlockBrush   // スポイト
}
```

回転の規則:

| プロパティ | R（水平） | Shift+R（縦） |
| --- | --- | --- |
| `axis` | x ↔ z | y にする（y なら x に戻す） |
| `facing` | north → east → south → west | up → down → north |
| `horizontal_facing` | north → east → south → west | 変えない |

Modpackがないと、そのブロックが取りうる値が分からない。Modpackがあれば、jar のブロック状態の定義（`assets/<namespace>/blockstates/<path>.json`）から取りうる値を読み、その範囲で回す（`edit/orientationOptions.ts`）。

- variants 形式：キー（`facing=north,powered=false`）に出てくる値を集める
- multipart 形式：`when` の条件（`OR` / `AND` の中、`a|b` の区切りを含む）に出てくる値を集める
- 定義に出てこない property は制限しない。multipart で否定の条件（`!north`）がある property も、値が足りないかもしれないので制限しない

Modpackがあれば、置くブロックを jar のブロックから名前で探せる（`analysis/blockCatalog.ts`）。

- 一覧は、ブロック状態の定義（blockstates）がある ID と、その日本語名・英語名。jar ごとの保存（IndexedDB）にブロック状態の定義が入っているので、jar を読み直さずに作れる。Modpack ごとに一度だけ作る
- 探す言葉は、全角を半角に、ひらがなをカタカナに、小文字にそろえて比べる。空白で区切った言葉がすべて、ID・日本語名・英語名のどれかに含まれれば合う。名前や ID がそのまま同じもの、言葉で始まるものを先に並べ、30件までを出す
- 一覧から選んだブロックの状態は、variants 形式なら最初のキーの値、multipart 形式などなら取りうる値のそれぞれ最初の値にする（`initialPropertiesFor`）。ゲームの初期値とは限らないので、画面で取りうる値から選び直せる
- Minecraft 本体のブロックは、本体の jar を見つけたときだけ一覧に出る（上の「Minecraft 本体の資産」）。見つからなければ ID の入力で選ぶ

## 値の出どころ

計算に使う値はどのModでも3種類に分かれる。

| 種類 | 例 | 出どころ（優先順） |
| --- | --- | --- |
| 個体の設定値 | クリエイティブモーターの回転数、速度コントローラーの設定 | ① 設計図の nbt → ② Modpackの初期値設定 → ③ 内蔵の初期値 |
| Modの定数 | 各ブロックの応力の消費量・供給量、回転数の上限 | ① Modpackの設定ファイル → ② 内蔵の初期値 |
| 構造から分かるもの | ベルトのつながり、シャフトの向き | ① ブロック状態 → ② nbt で補う |

```ts
type Provenance =
  | 'blueprint'   // 設計図の nbt やブロック状態から読んだ
  | 'modpack'     // Modpackの設定ファイルから読んだ
  | 'builtin'     // アプリ内蔵の初期値
  | 'virtual'     // 利用者が置いた仮の入出力
  | 'assumed'     // 情報がなく、アプリが仮定した

interface Resolved<T> {
  value: T
  source: Provenance
  note?: string   // 「範囲外は空気とみなした」など
}
```

優先順に値を探す処理と出どころの記録は共通部分に置く。各プラグインは「自分の内蔵の初期値」と「どこから値を引くか」の規則だけを書く。

## 設計図に入っていない情報

設計図ファイルはブロックとブロックエンティティの写しなので、次の情報は原理的に入らない。

| 種類 | 例 |
| --- | --- |
| ワールド全体に保存されるデータ | AE2のネットワーク、Createの線路網と列車、周波数でつながる送信機 |
| 設計図の範囲の外 | 範囲外の動力源や接続先 |
| 実行中にしかない状態 | 計算途中の値、組み立て中の仕掛け、毎tick再計算されるもの |
| 周りの環境 | バイオーム、明るさ、高度、天候 |

扱い方は2つ。

- **仮定（`assumed`）**：アプリが自動で置く。範囲外は空気とみなす、など。計算結果の仮定一覧に必ず載せる。
- **仮の入出力（`virtual`）**：利用者が意図して置く。下の `VirtualPort`。

## 仮の入出力（VirtualPort）

設計図の端のブロックの面に、利用者が仮の動力源や負荷を付けられる。計算では本物のブロックと同じように扱う。

```ts
interface VirtualPort {
  id: string
  pos: Vec3                       // 接続するブロックの位置
  face: Direction                 // どの面から入るか
  pluginId: string                // 'create-stress' など
  kind: string                    // 'rotation-source' など。種類はプラグインが定義
  params: Record<string, number>  // { rpm: 256, capacity: 4096 }
  label?: string                  // 「外の水車列」などのメモ
}
```

| プラグイン | 仮の入出力の例 |
| --- | --- |
| Createの応力 | 回転の供給（RPM、SU）、回転の消費（SU） |
| 電力系 | 電力の供給（FE/t）、電力の消費 |
| 生産量計算（将来） | アイテムの流入（個/分）、流体の流入（mB/秒） |

画面（#70）：ツールバーの「仮の入出力」でブロックの面をクリックして置く。種類と数値の入力欄は、プラグインの `portKinds` から作る。2D表示では面が分からないので、ブロックの `axis` の面のうち外か空きの面を選び、右パネルの一覧で直せるようにする。置いた仮の入出力は右パネルの一覧で値・面・メモを変えたり消したりでき、3D・2D表示に印（動力源は緑、負荷は橙）を出す。つなげない面に置いたときは、プラグインが計算の問題として知らせる。

仮の入出力は設計図の変更ではないので、編集の履歴（元に戻す）には入れない。

## calc：計算プラグイン

```ts
interface CalcPlugin {
  readonly id: string                          // 'create-stress'
  readonly portKinds: PortKindDef[]            // 受け付ける仮の入出力の種類。画面の入力欄に使う
  supports(bp: Blueprint, pack: Modpack | null): boolean
  run(bp: Blueprint, ctx: CalcContext): Promise<CalcResult>
}

interface CalcContext {
  pack: Modpack | null            // なければ内蔵の初期値で計算
  ports: VirtualPort[]            // このプラグイン宛ての仮の入出力
}

interface CalcResult {
  summary: { label: string; value: Resolved<string> }[]   // 「使用 2,048 SU / 供給 4,096 SU」
  issues: { pos: Vec3; message: string }[]                // 3D表示で強調する位置
  assumptions: { pos?: Vec3; message: string }[]          // 何を仮定して計算したか
}

class PluginRegistry {
  register(p: CalcPlugin): void
  available(bp: Blueprint, pack: Modpack | null): CalcPlugin[]
}
```

### 例：Createの応力プラグイン

```ts
class CreateStressPlugin implements CalcPlugin {
  async run(bp: Blueprint, ctx: CalcContext): Promise<CalcResult> {
    const values = new CreateValueResolver(CREATE_DEFAULTS, await CreateConfig.load(ctx.pack))
    const graph = KineticGraph.build(bp, ctx.ports)   // ブロックと向きから回転のつながりを作る
    return graph.evaluate(values)                      // ネットワークごとに供給と消費を比べる
  }
}
```

`KineticGraph` はCreate用に解釈したデータで、プラグインの中だけで使う。回転のつながり、数値、計算の手順は [create-stress.md](create-stress.md) に書く。

## ゲームとの行き来

書き出した `.nbt` は、Modpackの `schematics` フォルダに置けばCreateで読み込めるはず（未確認）。ゲームに持ち込むと、次のものが欠ける可能性がある。

- アプリで置いたブロックの生データ（ゲーム側の初期値になる）
- スキーマティキャノンが復元しない生データ
- Modpackにない Mod のブロック

書き出しの画面で、生データのないブロックの数と、足りないModを書き出し前に知らせる。

## アプリ独自のファイル

仮の入出力やメモは `.nbt` に書き込めないので、設計図とは別のファイルに保存する。

```
distillery.nbt             ← 設計図（そのまま）
distillery.mcircuit.json   ← 仮の入出力、メモ、建築チェックリスト、表示の設定
```

```ts
interface ProjectFile {
  version: 1
  blueprint: string               // 設計図のファイル名
  ports: VirtualPort[]
  notes: { pos: Vec3; text: string }[]
  checklist: { layer: number; done: boolean }[]
}
```

最初の版で作るかは別として、置き場所だけ先に決めておく。

今の作り（#70）：仮の入出力は、開いている設計図1つ分をメモリ（`calcStore.ports`）に持つだけで、ファイルには保存しない。別の設計図を開くと消える。`.mcircuit.json` の読み書きを作るときに、ここへつなぐ。

## 見た目（モデルとテクスチャ）

色付きの箱の代わりに、利用者の jar にあるモデルとテクスチャで描く。テクスチャとモデルは各 Mod の権利物なので、アプリにもリポジトリにも入れず、その場で読むだけにする。表示名の保存と同じく、読んだ結果をこの PC の中（IndexedDB）に保存するのはよい。

読む側と描く側は、`src/domain/blockModel.ts` の型だけで約束する。画面は `AppearanceSet` だけを受け取って描くので、jar の読み込みができる前から、偽のデータ（`tests/fixtures/fakeAppearance.ts`）で作れる。

```mermaid
flowchart LR
    jar["jar・リソースパック"] --> reader["AssetReader<br/>資産のファイルを読む"]
    reader --> resolver["ModelResolver<br/>blockstates → モデル → 親の継承"]
    reader --> atlas["TextureAtlasBuilder<br/>PNG を読んで1枚にまとめる"]
    resolver --> set["AppearanceSet<br/>（domain/blockModel.ts）"]
    atlas --> set
    set --> view3d["3D：モデルを描く"]
    set --> view2d["2D：上の面を描く"]
```

| 部分 | 場所 | 中身 |
| --- | --- | --- |
| 型 | `domain/blockModel.ts` | `ResolvedModel`・`BlockAppearance`・`TextureAtlas`・`AppearanceSet` |
| 約束 | `io/assets/assetTypes.ts` | `AssetReader`（パスで資産を読む）、`AppearanceProvider`（状態の一覧 → `AppearanceSet`） |
| 資産を読む | `io/assets/modpackAssetReader.ts`（`Modpack.assets()`） | Modpack の jar とリソースパックから、`assets/<ns>/models/`・`blockstates/`・`textures/` を必要なときに読む。部分読み（`readRange`）を使う。同じパスは優先度の高いものを使う |
| モデルの解決 | `io/assets/`（モデル側） | blockstates の variants / multipart から使うモデルを選び、`parent` をたどって要素とテクスチャの変数（`#side`）を確定する |
| テクスチャ | `io/assets/`（テクスチャ側） | PNG を RGBA にし、`.png.mcmeta` のアニメーションは1枚目だけ使い、アトラスにまとめる |
| 3D の描画 | `view/viewport/` | `AppearanceSet` からモデルのメッシュを作り、モデルごとに InstancedMesh で描く。`cullface` で隣のブロックに隠れる面を省く。見た目が `null` のブロックは今の色付きの箱 |
| 2D の描画 | `view/viewport/` | 各ブロックの上の面のテクスチャを、マス目に描く |

資産の読み方（`ModpackAssetReader`）：

- どの jar・zip のリソースパックにどのファイルがあるかの索引（`JarSummary.assets`。`models/`・`blockstates/`・`textures/` の下のパス。`.png.mcmeta` も含む）を、jar の読み込みのときに作り、jar ごとの保存（IndexedDB）に入れる。形式を変えたので保存の版を 2 にした（前の版の結果は読み直し、保存のときに消す）。jar の中の jar の資産は索引に入れない。
- 中身は頼まれたときに読む。索引にない jar は開かない。zip のファイルの一覧は jar ごとに最初の1回だけ読んで覚え、項目だけを部分読みする。同じ時に頼まれた同じ jar の項目はまとめて読む。`readRange` か `stat` がない、または想定と違う形の zip は、ファイル全体を読んで持っておく。
- 同じパスは「jar の外の翻訳」と同じ順で選ぶ：Minecraft 本体の jar < jar（名前順。後ろが優先） < `ModTranslations/` < `resourcepacks/` のうち `options.txt` にないもの < `options.txt` にあるもの。翻訳を持たないリソースパックの資産も読む。フォルダのパックは索引を持たず、そのパスを読んでみる。
- 1つのファイルは小さいので、展開（inflate）はその場で行う。読めない jar やファイルは `ModpackAssetReader.problems` に書き、次に優先度の高い場所を探す。

決まり：

- 重い処理（PNG の展開、アトラス作り、モデルの解決）は Web Worker で行う。`AppearanceSet` は構造化複製できる素のデータにする。
- Modpack がない、または見た目が分からないブロックは、今の色付きの箱で描く。テクスチャだけ見つからないときは `missing`（紫と黒）で描く。
- 色付け（`tintIndex`。草や葉）は、最初は決まった色（草の緑）を掛ける。バイオームの色は扱わない。
- 表示は「テクスチャ／色」で切り替えられるようにし、Modpack がないときは色にする。
- バニラ（`minecraft:`）のモデルとテクスチャは mods/ にないので、Minecraft 本体の jar から読む（「Minecraft 本体の資産」）。見つからなければ、バニラのブロックは色付きの箱で描く。

### モデルの解決（`io/assets/modelResolver.ts`）

`ModelResolver` は `AssetReader` だけを使い、`BlockState` → `BlockAppearance | null` を返す。分からないときは null（色付きの箱）にし、理由を `problems` に書く。

| 段階 | 場所 | 決まり |
| --- | --- | --- |
| blockstates | `blockStateSelector.ts` | variants はキーの property がすべて同じなら合う（`""`・`normal` と、キーにない property は何でもよい）。複数合えば後に書いたもの（Minecraft と同じ）。重み付きの配列は先頭。multipart は when が合う部分をすべて重ねる（`a|b`、先頭の `!` で否定、`OR`・`AND`） |
| モデルの JSON | `modelJson.ts` | namespace のない ID は `minecraft:`。uv のない面は要素の範囲を面に投影して決める（Minecraft と同じ）。読めない要素・面は飛ばして problems に書く |
| 親の継承 | `modelResolver.ts` | `textures` は根から順に子が上書きする。`elements` と `ambientocclusion` は一番子に近いものを使う。変数（`#a` → `#b` → ID）が決まらない面は `minecraft:missingno`（アトラスでは紫と黒）にする。親の循環は止めて null |
| 描けないもの | 同上 | `builtin/generated`・`builtin/entity` まで親をたどったら null。要素が1つもない見た目（BlockEntityRenderer で描くブロック）も null にして箱で描く。空気は何もない見た目 |
| 覚えておく | 同上 | ブロック状態の key ごと、モデルの ID ごと、ファイルのパスごとに結果を1つ持つ。同じ問題は1回だけ書く |

**バニラの親モデル。** Mod のモデルの多くは `block/cube_all` などのバニラの親を使うが、これは Mod の jar にない。バニラのモデルファイルはアプリに入れないので、よく使う親だけを、コードで同じ形に組み立てる（`builtinParentModels.ts`）。組み立てるのは「0〜16 の立方体の各面が `#down`・`#up`… を指す」という一般的な形と、変数名の対応（`all`、`end`/`side`、`top`/`bottom`/`side`、`front`）だけで、ファイルの写しではない。対象は `block/block`・`block/cube`・`block/cube_all`・`block/cube_column`・`block/cube_bottom_top`・`block/orientable`・`block/orientable_with_bottom`。利用者の資産（リソースパックや本体の jar）に同じ ID のモデルがあれば、そちらを先に使う。これ以外のバニラの親（階段、ハーフブロック、柵など）は見つからないとして扱い、色付きの箱で描く。

### つなぎ込み（Modpack → Worker → 画面）

| 部分 | 場所 | 中身 |
| --- | --- | --- |
| 本物の provider | `io/assets/assetAppearanceProvider.ts` | `AssetAppearanceProvider`：`ModelResolver` で状態を解決し、出てきたテクスチャで `TextureAtlasBuilder` がアトラスを作る。problems はモデル・テクスチャ・reader の分を重なりなくまとめる。読んだファイルは `CachingAssetReader` で覚え、作り直しでも2度読まない |
| 覚えておく | 同上 `CachedAppearanceProvider` | Modpack ごとに1つ。頼まれた状態をすべて覚え、知らない状態が来たときだけ全部の状態で作り直す。知っている状態だけなら前の結果を返す（開き直し、状態の少ない設計図） |
| Worker | `workers/appearance.worker.ts`・`appearanceWorkerHost.ts`・`appearanceProtocol.ts` | モデルの解決・PNG の展開・アトラス作りを Worker で行う。ファイルは Worker から読まず、`read` で画面側に頼む（デスクトップ版の Tauri のファイルの API は Worker から呼べないため）。同じ時に頼むものは1つのメッセージにまとめ、画面側の jar の部分読みがまとまるようにする。読んだバイト列とアトラスの画素は移す（transfer） |
| 画面側 | `workers/appearanceWorkerClient.ts` | `createAppearanceProvider(pack.assets())`。Worker が使えなければ同じスレッドで用意する（`InlineAppearanceProvider`）。jar の項目の展開は画面側で行うが、1つのファイルは小さい |
| つなぎ込み | `view/stores/appearanceSync.ts`（App.vue で1回呼ぶ） | Modpack（`modpackContent.pack`）が変わったら provider を作り直し（前のものは Worker ごと止める）、なければ null（色）。設計図を開いたらすぐ、編集でパレットの状態が増えたら少し待ってから、全リージョンのパレットの状態で `refresh` する。頼んだことのある状態だけなら何もしない |

読み込み中と problems の件数は「描き方」の切り替え（`AppearanceModeSwitch`）に出す。

## view：画面

- `ViewState`（Piniaのストア）：今の段、段の表示方法（上を消す・半透明・この段だけ）、段ごとの表示・非表示、3D/2D の切り替え、強調するブロック、今のツール
- `BlueprintMeshBuilder`：パレットの種類ごとに Three.js の InstancedMesh を1つ作る。ブロック数が多くても描画が軽い
- `LayerView2D`：選んだ段を canvas にマス目で描く。1つ下の段を薄く出す
- `Picker`：マウス位置から対象を求める。3D は当たったブロックと面の向き、何もなければ今の段の床。2D はマス目
- ツール：ツールごとにクラスを分け、同じ形でクリックと移動を受け取る

```ts
interface Tool {
  readonly id: 'select' | 'measure' | 'connect' | 'probe' | 'place' | 'erase' | 'pick'
  onHover(target: PickTarget | null): void
  onClick(target: PickTarget, mods: { shift: boolean }): void
}

interface PickTarget {
  pos: Vec3                 // 当たったブロック、または空きマス
  face?: Direction          // 3D で当たった面
  empty: boolean
}
```

プロトタイプでは、段を切り替えるたびにメッシュを作り直している。約9千ブロックで問題なく動いた。本実装では段の切り替えを描画側のクリッピングにする予定は変えない。

## 実物の .nbt で確認したこと

Create Astral（1.18.2）の設計図 `_.nbt`（8×1×4、23ブロック）と `[AstralExamples] Distillery.nbt` で確認した。

- 一番上の階層: `DataVersion`（2975）、`size`、`palette`、`blocks`、`entities`、`Railways_DataVersion`
- `palette` の各要素: `Name` と `Properties`（例: `create:cogwheel`、`axis: y`）
- `blocks` の各要素: `pos`、`state`（パレット番号）、`nbt`（ブロックエンティティの生データ。23個中16個が持つ）
- 歯車の `nbt`: `Speed`、`Source`（ワールド座標）、`Network`（`Size`、`Capacity`、`Stress` など）
- ベルトの `nbt`: `Controller`、`Length`、`Index`、載っているアイテム
- `Network` は保存時のワールドの状態で、設計図の外のブロックを含む（`Size: 26` に対して設計図内は23個）。計算結果には使わず、参考値として表示する程度にとどめる
- Distillery には `techreborn:`、`dbe:`、`custommachinery:` のブロックが含まれていた

## 未確認事項

- [x] ベルトのブロック状態だけで、つながりを組み立てられるか → 組み立てられる（[create-stress.md](create-stress.md)）
- [x] クリエイティブモーターなど、個体の設定値の初期値 → 16 RPM（[create-stress.md](create-stress.md)）
- [x] Createの応力の数値が、ワールドごとの `serverconfig/create-server.toml` に入っているか → 入っている（[create-stress.md](create-stress.md)）
- [x] Createのバージョンで、nbt の項目名が変わっていないか → 名前は同じ。位置の書き方だけ違う（[create-stress.md](create-stress.md)）
- [ ] 書き出した .nbt をCreateで読み込めるか。生データのないブロックがどう置かれるか
- [ ] ブロック状態の定義（blockstates の JSON）から、取りうる値の一覧を確実に作れるか。multipart 形式のブロックの扱い → 上の「置くブロック」の規則で作った。multipart は条件に出てくる値しか分からないため、本物の Create の jar で確かめる
- [x] 新規作成の設計図の `DataVersion` をどう決めるか → 利用者が選ぶ。Modpack があれば推定した値を最初に選んでおく（上の「BlueprintWriter」）
