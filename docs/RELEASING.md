# Versões e branches

## Repositórios

| Repositório | Visibilidade | Conteúdo |
|---|---|---|
| `davidosanjoss/apollo` | privado | Código, branches, CI |
| `davidosanjoss/apollo-releases` | público | Só as Releases (instaladores e manifestos de atualização) |

## Branches

| Branch | Papel |
|---|---|
| `main` | Só versões **estáveis**. Cada commit na `main` corresponde a uma versão com tag. |
| `dev` | Desenvolvimento. Todo trabalho entra aqui (direto ou via branches `feat/*`, `fix/*`). |

O CI roda em todo push na `dev` (só Linux, para poupar a cota de minutos do repo privado) e em PRs para a `main` (Linux e Windows).

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
4. O workflow `Release` valida (tag na main e igual ao `package.json`), gera AppImage, tar.gz, instalador `.exe` e zip, sobe tudo como **rascunho** no `apollo-releases` e só publica quando Linux e Windows terminaram, com as notas do CHANGELOG.
5. Sincronizar: `git checkout dev && git merge main`.

## Atualização automática

O app consulta o `apollo-releases` 15 s depois de abrir e a cada 6 h. Se houver versão nova, mostra uma barra com **Baixar e reiniciar** / **Depois**. Nada é baixado nem instalado sem aceitar. O download é conferido pelo hash SHA-512 do manifesto (`latest.yml` / `latest-linux.yml`).

- Atualiza sozinho: instalador `.exe` (Windows) e **AppImage** (Linux).
- `zip` e `tar.gz`: atualização manual.
- Em desenvolvimento (`npm start`) o atualizador fica desligado.

## Configuração única: token de publicação

O repo privado publica no público usando o secret `RELEASES_TOKEN`:

1. GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token
   - Repository access: **Only select repositories** → `apollo-releases`
   - Permissions: **Contents: Read and write** (o resto fica sem acesso)
   - Expiração: a que preferir (anote para renovar)
2. Salvar como secret no repo privado (o valor é pedido no terminal):
   ```bash
   gh secret set RELEASES_TOKEN -R davidosanjoss/apollo
   ```

## DRM no Windows (opcional)

Para Netflix/Prime funcionarem no Windows, o build precisa de assinatura VMP do castLabs:

1. Criar conta gratuita: `pip install castlabs-evs && python -m castlabs_evs.account signup`
2. Adicionar os secrets `EVS_ACCOUNT_NAME` e `EVS_PASSWD` no repositório do GitHub.

Sem isso, o build sai normalmente, só sem a assinatura.
