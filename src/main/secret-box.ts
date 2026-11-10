// Cifra com o chaveiro do sistema (KWallet/libsecret no Linux, DPAPI no Windows).
// Usada para cookies de sessão e para os segredos do Bitwarden. Assíncrona: as
// versões síncronas do safeStorage foram descontinuadas pelo Electron.

export interface SecretBox {
  encrypt(plain: string): Promise<Buffer>;
  decrypt(data: Buffer): Promise<string>;
}
