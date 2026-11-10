# Versões e branches

## Repositórios

| Repositório | Visibilidade | Conteúdo |
|---|---|---|
| `davidosanjoss/apollo` | público | Código, branches, CI e as Releases (instaladores e manifestos de atualização) |

## Branches

| Branch | Papel |
|---|---|
| `main` | Só versões **estáveis**. Cada commit na `main` corresponde a uma versão com tag. |
| `dev` | Desenvolvimento. Todo trabalho entra aqui (direto ou via branches `feat/*`, `fix/*`). |

O CI roda em todo push na `dev` e em PRs para a `dev` (Linux) e em PRs para a `main` (Linux e Windows). PRs de quem contribui pela primeira vez esperam a aprovação de um mantenedor para rodar.

## Versionamento

[SemVer](https://semver.org/lang/pt-BR/): `MAJOR.MINOR.PATCH`.

- Enquanto estiver em `0.x`, o MINOR sobe a cada fase/funcionalidade grande e o PATCH a cada correção.
- `1.0.0` = pronto para uso diário.

## Lançar uma versão estável

1. Na `dev`, atualizar `CHANGELOG.md` (mover "Não lançado" para a nova versão) e a versão:
   ```bash
   npm version 0.2.0 --no-git-tag-version
   git commit -am "chore: release v0.2.0"
   ```
2. Abrir PR `dev → main` e fazer o merge depois que o CI passar.
3. Criar a tag **na main**:
   ```bash
   git checkout main && git pull
   git tag v0.2.0 && git push origin v0.2.0
   ```
4. O workflow `Release` valida (tag na main e igual ao `package.json`), roda checagem de tipos e **todos os testes** (unitários em Linux e Windows, integração no Linux) — se algo falhar, nada é publicado —, gera AppImage, tar.gz, instalador `.exe` e zip, sobe tudo como **rascunho** nas Releases deste repositório e só publica quando Linux e Windows terminaram, com as notas do CHANGELOG.
5. Sincronizar: `git checkout dev && git merge main`.

## Atualização automática

O app consulta as Releases deste repositório (API pública do GitHub, sem dados do usuário) 15 s depois de abrir e a cada 6 h, em **qualquer** instalação empacotada. Se houver versão nova, mostra uma janela com as notas da versão (a seção do CHANGELOG publicada na release) e **Baixar e instalar** (AppImage/Windows) ou **Abrir a página de download** (zip/tar.gz), **Depois** e **Pular esta versão**. Na primeira abertura depois de atualizar, mostra as novidades uma vez. Configurações → Sobre tem **Verificar atualizações**. Nada é baixado nem instalado sem aceitar. O download é conferido pelo hash SHA-512 do manifesto (`latest.yml` / `latest-linux.yml`).

- Atualiza sozinho: instalador `.exe` (Windows) e **AppImage** (Linux).
- `zip` e `tar.gz`: atualização manual.
- Em desenvolvimento (`npm start`) o atualizador e o aviso ficam desligados (os testes usam `APOLLO_UPDATES_API` com uma API falsa).

## Token de publicação

Não precisa de nenhum: o workflow publica com o `GITHUB_TOKEN` dele (permissão `contents: write` só nos jobs de build e publicação). Até a 0.7.0 as versões ficavam num repositório separado (`apollo-releases`, descontinuado); todas foram trazidas para cá.

## DRM no Windows (opcional)

Para Netflix/Prime funcionarem no Windows, o build precisa de assinatura VMP do castLabs:

1. Criar conta gratuita: `pip install castlabs-evs && python -m castlabs_evs.account signup`
2. Adicionar os secrets `EVS_ACCOUNT_NAME` e `EVS_PASSWD` no repositório do GitHub.

Sem isso, o build sai normalmente, só sem a assinatura.

## Proteções

| Repositório | Proteção |
|---|---|
| `apollo` | `main`: só por PR com o CI verde (Linux e Windows), sem force-push, sem apagar, vale para admins. `dev`: sem force-push, sem apagar. Tags `v*`: imutáveis (não podem ser apagadas nem movidas). PRs de quem contribui pela primeira vez esperam aprovação para rodar o CI. |
