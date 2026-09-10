import path from 'node:path'

/**
 * Rastreia quais pastas já foram legitimamente associadas a uma busca — por uma pesquisa real ou
 * por uma entrada do histórico listada — para validar que um caminho vindo do renderer via IPC
 * realmente pertence a algo que o próprio app já expôs, em vez de confiar cegamente no valor
 * enviado.
 *
 * Defesa em profundidade: o fluxo normal da UI só envia `location`/`targetPath` vindo de um
 * FoundItem real (de uma busca ou do histórico reaberto), nunca digitado à mão. Isso fecha a
 * lacuna caso o renderer seja comprometido (dependência maliciosa, bug futuro do Electron) e tente
 * pedir diretamente ao main para ler ou escrever um arquivo fora do escopo de qualquer busca já
 * feita nesta sessão — ex.: ler um arquivo de credenciais do usuário, ou extrair um arquivo com
 * nome controlado para a pasta de inicialização do Windows.
 */
export class PathScope {
  private readonly knownRootFolders = new Set<string>()
  private readonly platform: NodeJS.Platform

  // Parâmetro explícito (em vez de "parameter property" do TS) porque o runner de testes usa o
  // type-stripping nativo do Node, que só remove anotação de tipo — não suporta essa sintaxe.
  constructor(platform: NodeJS.Platform = process.platform) {
    this.platform = platform
  }

  private normalize(p: string): string {
    const resolved = path.resolve(p)
    // Windows é case-insensitive no sistema de arquivos — sem isso, C:\Pasta e c:\pasta seriam
    // tratados como raízes diferentes por engano.
    return this.platform === 'win32' ? resolved.toLowerCase() : resolved
  }

  remember(rootFolder: string): void {
    this.knownRootFolders.add(this.normalize(rootFolder))
  }

  isKnown(candidatePath: string): boolean {
    const normalized = this.normalize(candidatePath)
    for (const root of this.knownRootFolders) {
      if (normalized === root || normalized.startsWith(root + path.sep)) return true
    }
    return false
  }

  /** Lança se o caminho não pertencer a nenhuma pasta já conhecida. */
  assertKnown(candidatePath: string): void {
    if (!this.isKnown(candidatePath)) {
      throw new Error('Caminho fora do escopo de qualquer busca realizada nesta sessão.')
    }
  }
}
