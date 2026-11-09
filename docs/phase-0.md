# Fase 0: validação técnica

Objetivo: confirmar as premissas antes de investir na base.

## Automático (`npm run diagnose`)

Resultado em Linux (CachyOS, Wayland), castLabs ECS 45.2.1, em 2026-11-09:

| Teste | Resultado | Observação |
|---|---|---|
| Widevine (DRM) | ✅ | CDM 4.10.3112.0 baixado automaticamente |
| Vídeo por GPU | ✅ | H.264, VP9 e AV1 com decodificação por hardware |
| DNS seguro (DoH) | ✅ | Modo `secure` funcionando |
| User agent limpo | ✅ | Sem "Electron", aparece como Chrome |
| Cookie persistente após reinício | ✅ | |
| Cookie de sessão após reinício | ❌ | Esperado. Tratado na fase 2 (ver ARCHITECTURE D5) |

No Windows: rodar `npm run diagnose` na outra máquina e anotar aqui.

## Manual: logins

Rodar `npm start` e testar em workspaces diferentes:

- [ ] Google (Gmail/Drive): login completo, sem aviso "navegador não seguro"
- [ ] YouTube logado
- [ ] Outlook pessoal (outlook.live.com)
- [ ] Outlook do trabalho (outlook.office.com), incluindo verificação de dispositivo/MFA
- [x] Contas isoladas entre workspaces, logadas ao mesmo tempo sem uma derrubar a outra (validado em 2026-11-09)
- [ ] Fechar e reabrir o Apollo: os logins continuam
- [ ] Streaming com DRM (ex.: Netflix ou Spotify web) toca

Se o Google bloquear o login: anotar a mensagem exata. O contorno previsto é um user agent específico para `accounts.google.com`.
