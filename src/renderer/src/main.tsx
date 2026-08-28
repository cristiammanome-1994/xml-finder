import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

try {
  const storedTheme = localStorage.getItem('xml-finder-theme')
  if (storedTheme === 'dark') document.documentElement.classList.add('dark')
} catch {
  // localStorage indisponível (ex.: navegação de teste) — mantém tema claro padrão
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
