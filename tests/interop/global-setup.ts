// Roda antes dos processos de teste: gera o certificado do Vaultwarden e faz o
// Node (fetch) e o CLI oficial confiarem nele (NODE_EXTRA_CA_CERTS só é lido na partida).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export default function setup(): () => void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-vw-cert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', `${dir}/key.pem`, '-out', `${dir}/cert.pem`], { stdio: 'ignore' });
  fs.chmodSync(`${dir}/key.pem`, 0o644);
  process.env.APOLLO_INTEROP_CERT_DIR = dir;
  process.env.NODE_EXTRA_CA_CERTS = `${dir}/cert.pem`;
  return () => fs.rmSync(dir, { recursive: true, force: true });
}
