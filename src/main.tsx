import '@fontsource-variable/archivo'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/inter'
import '@fontsource-variable/source-serif-4'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
