// Ícone do workspace na barra lateral (pedido do usuário): em vez da primeira letra.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, tempProfile, waitFor } from './harness';

let app: Apollo;
let profile: ReturnType<typeof tempProfile>;

beforeAll(async () => {
  profile = tempProfile();
  app = await Apollo.launch(profile.dir);
});
afterAll(async () => {
  await app?.quit();
  profile?.cleanup();
});

const ui = <T>(js: string) => app.ui.eval<T>(js);
const buttons = () => ui<string[]>(`[...document.querySelectorAll('#workspace-list .ws-btn')].map((b) => b.textContent)`);

describe('ícone do workspace', () => {
  it('novo workspace com ícone escolhido na grade', async () => {
    await app.ui.mouseClick('#add-workspace');
    await waitFor(() => ui<boolean>(`document.getElementById('ws-dialog').open`), 'diálogo');
    await ui(`document.getElementById('ws-name').value = 'Faculdade'; true`);
    await app.ui.mouseClick('#ws-icon-grid button[title="🎓"]');
    expect(await ui<boolean>(`document.querySelector('#ws-icon-grid button[title="🎓"]').classList.contains('selected')`)).toBe(true);
    await ui(`document.getElementById('ws-form').requestSubmit(); true`);
    const s = await app.until((x) => x.workspaces.length === 2, 'criado');
    expect(s.workspaces.find((w) => w.name === 'Faculdade')!.icon).toBe('🎓');
    await waitFor(async () => (await buttons()).join() === 'P,🎓', 'barra lateral com o ícone');
  });

  it('emoji colado (só o primeiro vale) e "Sem ícone" volta para a letra', async () => {
    const fac = (await app.state()).workspaces.find((w) => w.name === 'Faculdade')!;
    await app.send({ type: 'workspace:update', workspaceId: fac.id, name: fac.name, color: fac.color, home: '', icon: '📚' });
    await waitFor(async () => (await buttons())[1] === '📚', 'trocou');
    await app.send({ type: 'workspace:update', workspaceId: fac.id, name: fac.name, color: fac.color, home: '', icon: null });
    await waitFor(async () => (await buttons())[1] === 'F', 'voltou para a letra');
    // Ícone inválido é recusado pelo processo principal (nada muda).
    await app.send({ type: 'workspace:update', workspaceId: fac.id, name: fac.name, color: fac.color, home: '', icon: '<img>' });
    await new Promise((r) => setTimeout(r, 300));
    expect((await buttons())[1]).toBe('F');
  });
});
