import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './view/App.vue'
import './view/style.css'

createApp(App).use(createPinia()).mount('#app')
