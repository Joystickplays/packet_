import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Toaster } from 'sonner'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Toaster toastOptions={{
      style: {
        background: 'black',
        color: 'rgba(255,255,255,0.8)',
        border: '1px solid rgba(255,255,255,0.2)',
        fontFamily: 'JetBrains Mono Variable'
      }
    }} />
  </StrictMode>,
)
