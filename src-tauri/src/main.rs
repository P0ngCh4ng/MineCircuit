// MineCircuit デスクトップ版の起動。
// 画面・読み込み・編集・計算はすべて TypeScript 側にあり、ここでは Tauri を起動して
// 公式プラグインを登録するだけにする。独自のコマンドは作らない（docs/design.md「デスクトップ版（Tauri）」）。

// リリースのビルドでは、Windows でコンソールの窓を出さない
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        // ファイルの読み書き。読み書きできるのは、ダイアログで利用者が選んだ場所だけ（capabilities/default.json）
        .plugin(tauri_plugin_fs::init())
        // ファイル・フォルダを選ぶ画面と、保存先を選ぶ画面
        .plugin(tauri_plugin_dialog::init())
        // ダイアログで許可した範囲を保存し、次回の起動でも同じ範囲を読めるようにする。fs のあとに登録する
        .plugin(tauri_plugin_persisted_scope::init())
        .run(tauri::generate_context!())
        .expect("MineCircuit の起動に失敗しました");
}
