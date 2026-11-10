// Vídeo flutuante (picture-in-picture). Os scripts rodam num mundo isolado da página
// (a página não consegue mexer neles), com gesto do usuário vindo do processo principal.

export const PIP_WORLD = 1002;

/**
 * Liga/desliga: se já há vídeo flutuante, fecha; senão escolhe o vídeo tocando (o maior),
 * ou o maior da página. Devolve 'opened' | 'closed' | 'no-video' | 'error:<nome>'.
 */
export const PIP_TOGGLE = `(async () => {
  if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return 'closed'; }
  const area = (v) => { const r = v.getBoundingClientRect(); return r.width * r.height; };
  const videos = [...document.querySelectorAll('video')].filter((v) => v.readyState >= 1);
  const playing = videos.filter((v) => !v.paused && !v.ended);
  const pick = (playing.length ? playing : videos).sort((a, b) => area(b) - area(a))[0];
  if (!pick) return 'no-video';
  pick.removeAttribute('disablepictureinpicture'); // alguns sites bloqueiam; a escolha é do usuário
  try { await pick.requestPictureInPicture(); return 'opened'; } catch (e) { return 'error:' + e.name; }
})()`;

/** Espera o vídeo flutuante fechar (pelo ✕ dele, por exemplo). */
export const PIP_WAIT_CLOSE = `new Promise((resolve) => {
  const v = document.pictureInPictureElement;
  if (!v) return resolve('closed');
  v.addEventListener('leavepictureinpicture', () => resolve('closed'), { once: true });
})`;

/** A página tem algum vídeo com imagem (para oferecer o botão)? */
export const PIP_HAS_VIDEO = `[...document.querySelectorAll('video')].some((v) => v.readyState >= 1 && v.videoWidth > 0)`;
