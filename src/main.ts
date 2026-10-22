import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './view/App.vue'
import './view/style.css'

createApp(App).use(createPinia()).mount('#app')

// 開発中だけ：偽の見た目をブラウザで確かめる手段（本番のビルドには入らない）
if (import.meta.env.DEV) void import('./view/dev/devAppearance').then((m) => m.installDevAppearance())
