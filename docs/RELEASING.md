# Versões e branches

## Branches

| Branch | Papel |
|---|---|
| `main` | Só versões **estáveis**. Cada commit na `main` corresponde a uma versão com tag. |
| `dev` | Desenvolvimento. Todo trabalho entra aqui (direto ou via branches `feat/*`, `fix/*`). |

O CI roda em todo push na `dev` e em PRs, gerando builds de Linux e Windows como artefatos (7 dias).

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
4. O workflow `Release` valida (tag na main e igual ao `package.json`), gera AppImage, tar.gz, instalador `.exe` e zip, e publica a GitHub Release com as notas do CHANGELOG.
5. Sincronizar: `git checkout dev && git merge main`.

## DRM no Windows (opcional)

Para Netflix/Prime funcionarem no Windows, o build precisa de assinatura VMP do castLabs:

1. Criar conta gratuita: `pip install castlabs-evs && python -m castlabs_evs.account signup`
2. Adicionar os secrets `EVS_ACCOUNT_NAME` e `EVS_PASSWD` no repositório do GitHub.

Sem isso, o build sai normalmente, só sem a assinatura.
