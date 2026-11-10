# Contribuindo com o Apollo

Obrigado pelo interesse! Correções, melhorias e ideias são bem-vindas.

## Antes de começar

- Para mudanças grandes (funcionalidade nova, troca de arquitetura), abra uma *issue* antes para conversarmos sobre a ideia.
- Bugs: descreva o que aconteceu, o que esperava e como reproduzir (sistema, versão do Apollo).
- Falhas de segurança: **não** abra issue pública. Use *Security → Report a vulnerability* no GitHub.

## Fluxo

1. Faça um fork e crie uma branch a partir da `dev` (`feat/…`, `fix/…`).
2. Abra o pull request **para a `dev`** (a `main` só recebe versões estáveis).
3. O CI roda tipos e testes. Para quem contribui pela primeira vez, o CI espera a aprovação de um mantenedor.

## Ambiente

Node.js 22+ (o CI usa o 24).

```bash
npm install
npm start        # abre o navegador (perfil separado: apollo-dev)
npm run check    # tipos + unitários + integração (o mesmo do CI)
```

Os testes de integração abrem o app de verdade, sem janela, e o controlam (ver [docs/TESTING.md](docs/TESTING.md)).

## Regras do projeto

- **Testes.** Toda funcionalidade tem testes unitários e de integração. Todo bug corrigido ganha um teste de regressão, comentado com `// Regressão:` explicando o que quebrava.
- **Privacidade.** Nada de telemetria, nem de chamadas a serviços externos que não sejam necessárias para a funcionalidade. Se algo precisa da rede, diga no PR o quê e por quê.
- **Segurança.** Código das páginas nunca recebe acesso ao processo principal; a interface valida todo comando (`src/main/ipc.ts`). Leia [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) antes de mexer em abas, sessões ou no cofre.
- **Nada pessoal no repositório.** Sem e-mails, caminhos da sua máquina, tokens ou endereços privados no código, testes ou commits.
- **Português do Brasil** na interface, nos comentários e na documentação.
- **Commits** no estilo `tipo: descrição` (`feat`, `fix`, `perf`, `docs`, `test`, `chore`), dizendo o *porquê*.

## Licença

Ao contribuir, você concorda que sua contribuição seja distribuída sob a [GPL-3.0-or-later](LICENSE), a mesma licença do projeto.
