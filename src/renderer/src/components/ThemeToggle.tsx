import { Moon, Sun } from 'lucide-react'
import { useStore } from '../store'

export function ThemeToggle() {
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)
  const label = theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'

  return (
    <button className="btn ghost icon" onClick={toggleTheme} aria-label={label} title={label}>
      {theme === 'dark' ? <Sun className="icon" /> : <Moon className="icon" />}
    </button>
  )
}
