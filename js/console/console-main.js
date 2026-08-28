// js/console/console-main.js
// Entry point della Console Admin (Milestone B — SOLA LETTURA).
// Orchestrazione: guardia admin -> shell -> sezioni. Nessuna scrittura.

import { onAdminState, logout } from './console-auth.js';
import { esc } from './console-ui.js';
import { renderRagazzi } from './console-ragazzi.js';
import { renderComunita } from './console-comunita.js';
import { renderOperatori, renderPermessi } from './console-operatori.js';

const main = document.getElementById('cadmin-main');
const tabs = document.getElementById('cadmin-tabs');
const who = document.getElementById('cadmin-who');
const btnLogout = document.getElementById('cadmin-logout');

const SECTIONS = {
  ragazzi:   { label: 'Ragazzi',   render: (c) => renderRagazzi(c, 'ordinarie') },
  comunita:  { label: 'Comunità',  render: (c) => renderComunita(c) },
  afterus:   { label: 'After Us',  render: (c) => renderRagazzi(c, 'afterus') },
  operatori: { label: 'Operatori', render: (c) => renderOperatori(c) },
  permessi:  { label: 'Permessi',  render: (c) => renderPermessi(c) },
};
const DEFAULT_SECTION = 'ragazzi';

let booted = false;

onAdminState((state) => {
  if (!state.user) return showDenied('login');
  if (!state.isAdmin) return showDenied('not-admin', state.user);
  showConsole(state);
});

function showDenied(reason, user) {
  tabs.hidden = true;
  btnLogout.hidden = !user;
  who.textContent = '';
  if (user) {
    btnLogout.hidden = false;
    btnLogout.onclick = () => logout();
  }
  const msg = reason === 'login'
    ? { icon: '🔒', title: 'Accesso riservato', body: 'Questa Console è riservata agli amministratori. Accedi con un account autorizzato.', link: 'login.html', linkText: 'Vai al login →' }
    : { icon: '⛔', title: 'Non autorizzato', body: 'Il tuo account è autenticato ma non è un amministratore (né UID legacy né staff.admin === true).', link: 'index.html', linkText: '← Torna al sito' };
  main.innerHTML = `
    <div class="cadmin-denied">
      <div class="ad-icon">${msg.icon}</div>
      <strong>${msg.title}</strong>
      <p>${esc(msg.body)}</p>
      <a href="${msg.link}">${esc(msg.linkText)}</a>
    </div>`;
}

function showConsole(state) {
  who.innerHTML = `${esc(state.user.displayName || state.user.email || state.user.uid)}<br>admin · ${esc(state.via)}`;
  btnLogout.hidden = false;
  btnLogout.onclick = () => logout();
  tabs.hidden = false;

  if (!booted) {
    booted = true;
    tabs.querySelectorAll('.cadmin-tab').forEach((btn) => {
      btn.addEventListener('click', () => navigate(btn.dataset.section));
    });
    window.addEventListener('hashchange', () => {
      const s = (location.hash || '').replace('#', '');
      if (SECTIONS[s]) activate(s);
    });
  }

  const fromHash = (location.hash || '').replace('#', '');
  activate(SECTIONS[fromHash] ? fromHash : DEFAULT_SECTION);
}

function navigate(section) {
  if (!SECTIONS[section]) return;
  if (location.hash !== '#' + section) location.hash = section; // triggers hashchange -> activate
  else activate(section);
}

let current = null;
function activate(section) {
  if (!SECTIONS[section]) return;
  current = section;
  tabs.querySelectorAll('.cadmin-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.section === section);
  });
  main.innerHTML = '<div class="spinner"></div>';
  Promise.resolve(SECTIONS[section].render(main)).catch((e) => {
    main.innerHTML = `<p class="empty-msg" style="color:#b03a2e">Errore nella sezione: ${esc(e.message)}</p>`;
  });
}
