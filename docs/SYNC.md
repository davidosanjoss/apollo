# Sincronização entre computadores

O Apollo sincroniza **workspaces, favoritos (com pastas), painéis, personalizações e algumas preferências** (corretor, histórico ligado/desligado, barra de favoritos, downloads, vídeo flutuante, modo leitura) pelo **Google Drive** ou pelo **OneDrive**.

Não sincroniza: abas, histórico, cookies, logins, senhas, permissões de sites, DNS, módulos e workspaces temporários.

## Como funciona

- **Cifrado no seu computador.** Antes de sair, tudo é cifrado com a sua *senha de sincronização* (scrypt + AES-256-GCM). A nuvem só guarda um arquivo ilegível (`apollo-sync.json`). A senha nunca é enviada; sem ela, ninguém (nem você) abre os dados. Use a mesma senha em todos os computadores.
- **Só a pasta do aplicativo.** No Google Drive, a pasta oculta do app (`drive.appdata`); no OneDrive, a pasta do app (`Files.ReadWrite.AppFolder`). O Apollo não enxerga os seus arquivos.
- **Mesclagem.** Cada computador compara com a última sincronização: o que mudou de um lado vale; se o mesmo item mudou nos dois, vale o do computador que está sincronizando; apagado de um lado e editado do outro, fica a edição. Na primeira conexão de um computador, a nuvem vence e workspaces com o mesmo nome (ex.: o "Principal" de cada um) viram o mesmo.
- **Quando.** A cada minuto, se algo mudou neste computador; a cada 5 minutos, para buscar o que mudou nos outros; e em Configurações → Sincronização → *Sincronizar agora*.
- **Onde ficam os acessos.** O token da nuvem e a senha de sincronização ficam cifrados pelo chaveiro do sistema. Sem chaveiro (alguns Linux), ficam só na memória e é preciso conectar a cada abertura.

## ID do aplicativo (uma vez)

O Google e a Microsoft só deixam um programa acessar o Drive/OneDrive com um "ID de aplicativo" cadastrado. Enquanto o Apollo não tiver um próprio publicado, você cria o seu (gratuito) e informa em Configurações → Sincronização.

### Google Drive

1. Em <https://console.cloud.google.com/>, crie um projeto (qualquer nome).
2. *APIs e serviços → Biblioteca*: ative a **Google Drive API**.
3. *APIs e serviços → Tela de consentimento OAuth*: tipo **Externo**; preencha o nome do app e o seu e-mail; em *Escopos*, adicione `.../auth/drive.appdata`; em *Usuários de teste*, adicione a(s) sua(s) conta(s) Google.
4. *Credenciais → Criar credenciais → ID do cliente OAuth*: tipo **App para computador**.
5. Copie o **ID do cliente** e a **Chave secreta do cliente** para o Apollo.

(Em modo "teste", o Google pede para confirmar o login de tempos em tempos; publicar o app de uso pessoal tira esse limite.)

### OneDrive

1. Em <https://portal.azure.com/> → *Microsoft Entra ID → Registros de aplicativo → Novo registro*.
2. *Tipos de conta*: **Contas em qualquer diretório organizacional e contas Microsoft pessoais**.
3. *URI de redirecionamento*: plataforma **Cliente público/nativo (móvel e área de trabalho)** com `http://localhost`.
4. *Permissões de API → Adicionar → Microsoft Graph → Permissões delegadas*: `Files.ReadWrite.AppFolder` e `offline_access`.
5. Copie o **ID do aplicativo (cliente)** para o Apollo (o OneDrive não usa chave secreta).

## Desconectar

Configurações → Sincronização → *Desconectar este computador*: o computador para de sincronizar; os dados locais e o arquivo na nuvem ficam. Para apagar da nuvem, apague o app nas permissões da sua conta Google/Microsoft (isso remove a pasta do app).
