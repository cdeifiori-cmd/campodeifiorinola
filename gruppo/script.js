// Menu mobile
const menuBtn = document.querySelector('.menu-btn');
const menu = document.getElementById('menu');
menuBtn.addEventListener('click', () => {
  const open = menu.classList.toggle('open');
  menuBtn.setAttribute('aria-expanded', open);
});
menu.addEventListener('click', e => { if (e.target.tagName === 'A') { menu.classList.remove('open'); menuBtn.setAttribute('aria-expanded', false); } });

// Copia 5x1000 / IBAN
document.querySelectorAll('.copia').forEach(b => b.addEventListener('click', async () => {
  const testo = b.textContent;
  try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copiato ✓'; }
  catch { b.textContent = b.dataset.copy; }
  setTimeout(() => { b.textContent = testo; }, 2000);
}));

// Musica: parte da sola solo alla prima visita; poi resta il pulsante ♪ per riascoltarla.
(() => {
  const box = document.getElementById('musica');
  const audio = document.getElementById('musica-audio');
  const btnPlay = box.querySelector('.play');
  const btnRiavvia = box.querySelector('.riavvia');
  const CHIAVE = 'cdf-musica-ascoltata';
  const leggi = () => { try { return localStorage.getItem(CHIAVE); } catch { return '1'; } };
  const segna = () => { try { localStorage.setItem(CHIAVE, '1'); } catch {} };
  audio.volume = 0.5;

  const aggiorna = () => {
    const suona = !audio.paused;
    box.classList.toggle('suona', suona);
    btnPlay.textContent = suona ? '❚❚' : '▶';
    btnPlay.setAttribute('aria-label', suona ? 'Ferma la musica' : 'Ascolta la musica');
    btnPlay.title = suona ? 'Ferma' : 'Ascolta';
  };
  const suona = () => audio.play().then(() => { segna(); box.classList.remove('mini'); }).catch(() => {});
  audio.addEventListener('play', aggiorna);
  audio.addEventListener('pause', aggiorna);
  audio.addEventListener('ended', () => { box.classList.add('mini'); aggiorna(); });

  btnPlay.addEventListener('click', () => {
    if (audio.paused) suona();
    else { audio.pause(); audio.currentTime = 0; }
  });
  btnRiavvia.addEventListener('click', () => { audio.currentTime = 0; suona(); });

  // I browser bloccano l'audio finché il visitatore non interagisce: in quel caso parte al primo tocco/tasto.
  const avviaOAlPrimoGesto = () => {
    audio.play().then(segna).catch(() => {
      const alPrimoGesto = e => {
        if (box.contains(e.target)) return;   // i pulsanti gestiscono da sé
        suona();
        ['pointerdown', 'keydown', 'touchstart'].forEach(t => removeEventListener(t, alPrimoGesto, true));
      };
      ['pointerdown', 'keydown', 'touchstart'].forEach(t => addEventListener(t, alPrimoGesto, true));
    });
  };

  // Passando da una pagina all'altra, se stava suonando riprende dallo stesso punto.
  const CONT = 'cdf-musica-continua';
  addEventListener('pagehide', () => {
    try { sessionStorage.setItem(CONT, JSON.stringify({ attiva: !audio.paused, pos: audio.currentTime })); } catch {}
  });
  let prec = null;
  try { prec = JSON.parse(sessionStorage.getItem(CONT) || 'null'); } catch {}

  if (prec && prec.attiva) {
    box.classList.remove('mini');
    audio.preload = 'auto';
    audio.addEventListener('loadedmetadata', () => { audio.currentTime = prec.pos || 0; }, { once: true });
    audio.load();
    avviaOAlPrimoGesto();
  } else if (!leggi()) {
    box.classList.remove('mini');
    audio.preload = 'auto';
    avviaOAlPrimoGesto();
  }
})();

// Comparsa morbida delle sezioni
const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
}, { rootMargin: '0px 0px -8% 0px' }) : null;
document.querySelectorAll('.reveal').forEach(el => io ? io.observe(el) : el.classList.add('in'));
