# Apollo

Navegador pessoal, leve e focado em privacidade, construído sobre Chromium (Electron/castLabs ECS).

> **Status:** em desenvolvimento ativo (0.x). Já dá para usar no dia a dia, mas pode mudar bastante entre versões.

## Por que existe

- **Workspaces com sessão isolada.** Cada workspace (ex.: Pessoal, Trabalho, Faculdade) tem cookies, logins e storage próprios. Você fica logado em três contas Outlook ao mesmo tempo, sem uma derrubar a outra.
- **Leve onde importa.** Só carrega o que você está usando. Abas paradas hibernam (RAM ≈ 0) e recarregam ao clicar. Vídeo e aba ativa usam o que precisarem.
- **Privacidade como padrão.** Zero telemetria, bloqueio de anúncios e rastreadores (configurável por workspace, site e aba), DNS criptografado.
- **Compatível.** Google e Microsoft funcionam como no Chrome. Streaming com DRM via Widevine.
- **O resto que se espera de um navegador.** Favoritos com pastas, histórico, downloads, Bitwarden integrado, painéis laterais (WhatsApp, Teams…), tela dividida, modo leitura, vídeo flutuante, sincronização cifrada entre computadores (Google Drive ou OneDrive).

## Download

Versões estáveis: [Releases](https://github.com/davidosanjoss/apollo/releases) (AppImage e tar.gz para Linux; instalador `.exe` e zip para Windows). O app avisa quando há versão nova e mostra o que mudou; AppImage e instalador do Windows se atualizam sozinhos.

Arch, CachyOS, Manjaro e derivados: pelo AUR, `paru -S apollo-browser-bin` (ou `yay`); as atualizações vêm com o resto do sistema.

Para usar como navegador padrão: Configurações → Sobre o Apollo → *Tornar o Apollo o navegador padrão*.

## Rodando a partir do código

Requer Node.js 22+.

```bash
npm install
npm start          # compila e abre o navegador (perfil separado: apollo-dev)
npm run typecheck  # checagem de tipos (TypeScript)
npm run diagnose   # valida Widevine, vídeo por GPU, DNS, cookies nesta máquina
npm test           # testes unitários
npm run test:e2e   # testes de integração (abre o app real; ver docs/TESTING.md)
```

Código em `src/`: `main/` (processo principal), `renderer/` (UI), `preload/`, `shared/` (contrato UI ↔ main) e `pages/` (páginas internas `apollo://`). Detalhes em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Builds:

```bash
npm run dist:linux   # AppImage + tar.gz
npm run dist:win     # instalador NSIS + zip (funciona a partir do Linux)
```

## Configuração local

O DNS se configura pela tela de configurações (⚙ na barra lateral). Ela grava num arquivo **fora do repositório**, na pasta de dados do app, que também pode ser editado à mão:

- Linux: `~/.config/apollo/settings.json`
- Windows: `%APPDATA%\apollo\settings.json`

```json
{
  "dns": {
    "mode": "secure",
    "dohUrl": "https://SEU-ID.cloudflare-gateway.com/dns-query"
  }
}
```

`mode`: `secure` (só DoH), `automatic` (DoH com fallback) ou `off`. Sem `dohUrl`, usa o DoH público da Cloudflare.

## Documentação

- [Arquitetura e decisões](docs/ARCHITECTURE.md)
- [Fase 0: validação técnica](docs/phase-0.md)
- [Versões e branches](docs/RELEASING.md)
- [Testes](docs/TESTING.md)
- [Sincronização](docs/SYNC.md)
- [Changelog](CHANGELOG.md)

## Contribuindo

Pull requests são bem-vindos: veja [CONTRIBUTING.md](CONTRIBUTING.md).

## Licença

[GPL-3.0-or-later](LICENSE). Você pode usar, estudar, modificar e redistribuir o Apollo; versões modificadas distribuídas também precisam ter o código aberto sob a GPL.
