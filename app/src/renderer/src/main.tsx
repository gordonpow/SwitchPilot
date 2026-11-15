import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installMockApi } from './lib/mock-api'

// 純瀏覽器預覽（沒有 preload 注入 window.api）時使用假資料。
if (!window.api) installMockApi()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
