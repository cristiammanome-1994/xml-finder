import { useEffect } from 'react'

/**
 * Fecha um painel/modal com a tecla Esc.
 *
 * Todos os overlays do app fecham clicando fora, mas isso deixava de fora quem navega por
 * teclado — e Esc é o gesto que qualquer usuário tenta primeiro para sair de uma janela.
 */
export function useEscapeKey(enabled: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onEscape()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, onEscape])
}
