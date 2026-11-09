'use strict';

const greeting = document.getElementById('greeting');
const clock = document.getElementById('clock');
const date = document.getElementById('date');

function tick() {
  const now = new Date();
  const h = now.getHours();
  greeting.textContent = h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  clock.textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  date.textContent = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

tick();
// Atualiza na virada do minuto, sem timer rodando a cada segundo.
setTimeout(() => { tick(); setInterval(tick, 60_000); }, (60 - new Date().getSeconds()) * 1000);
