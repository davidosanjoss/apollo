# Apollo

Navegador pessoal em Electron (castLabs, com Widevine). Arquitetura em `docs/ARCHITECTURE.md`, versões em `docs/RELEASING.md`, testes em `docs/TESTING.md`.

- Trabalho na branch `dev`; `main` só recebe versões estáveis.
- Antes de commitar: `npm run check` (tipos + unitários + integração; para no primeiro erro). Nunca encadear o commit depois de um `| grep`, que esconde a falha.
- Todo bug encontrado ganha um teste de regressão (ver `docs/TESTING.md`), marcado com `// Regressão:`.
- Repositório pode ficar público: nada de e-mails, caminhos pessoais, tokens ou o endereço do Zero Trust Gateway no código ou nos commits.
