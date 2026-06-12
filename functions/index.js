/**
 * Cloud Functions — Campo dei Fiori
 *
 * TRIGGER:
 *  1. onNuovoContenuto   — diario/{postId} creato
 *                          → broadcast a tutti (escluso autore)
 *  2. onNuovaBottiglia   — messaggiBottiglia/{id} creato
 *                          → solo al destinatario
 *  3. onNuovoCommento    — diario/{postId}/commenti/{id} creato
 *                          → solo al proprietario del post (se non è lui il commentatore)
 *  4. onNuovoCommentoBott — messaggiBottiglia/{id}/commenti/{id} creato
 *                          → a mittente + destinatario bottiglia (escluso il commentatore)
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp }     = require('firebase-admin/app');
const { getFirestore }      = require('firebase-admin/firestore');
const { getMessaging }      = require('firebase-admin/messaging');

initializeApp();
const db        = getFirestore();
const messaging = getMessaging();

// ─── Helper: token di un singolo utente ──────────────────────────────────

async function getTokensForUid(uid) {
  for (const coll of ['utenti', 'staff', 'amici']) {
    try {
      const snap = await db.collection(coll).doc(uid).get();
      if (!snap.exists) continue;
      const d = snap.data();
      const tokens = [];
      if (Array.isArray(d.fcmTokens)) tokens.push(...d.fcmTokens.filter(t => t?.length > 10));
      if (d.fcmToken?.length > 10) tokens.push(d.fcmToken);
      return [...new Set(tokens)];
    } catch (_) {}
  }
  return [];
}

// ─── Helper: tutti i token (broadcast) ───────────────────────────────────

async function getAllFcmTokens(excludeUid = null) {
  console.log('[FCM] Raccolta token, escludo UID:', excludeUid);
  const tokens = [];
  for (const coll of ['utenti', 'staff', 'amici']) {
    try {
      const snap = await db.collection(coll).get();
      snap.forEach(docSnap => {
        if (docSnap.id === excludeUid) return;
        const d = docSnap.data();
        if (Array.isArray(d.fcmTokens)) d.fcmTokens.forEach(t => { if (t?.length > 10) tokens.push(t); });
        if (d.fcmToken?.length > 10) tokens.push(d.fcmToken);
      });
      console.log(`[FCM] Collezione '${coll}': ${snap.size} doc letti`);
    } catch (err) {
      console.error(`[FCM] Errore lettura '${coll}':`, err.message);
    }
  }
  const unique = [...new Set(tokens)];
  console.log(`[FCM] Token validi trovati: ${unique.length}`);
  return unique;
}

// ─── Helper: nome autore ──────────────────────────────────────────────────

async function getNome(uid) {
  for (const coll of ['utenti', 'staff', 'amici']) {
    try {
      const snap = await db.collection(coll).doc(uid).get();
      if (snap.exists) { const n = snap.data().nome; if (n) return n; }
    } catch (_) {}
  }
  return 'Qualcuno';
}

function tronca(testo, max = 80) {
  if (!testo || typeof testo !== 'string') return '';
  return testo.length > max ? testo.slice(0, max) + '…' : testo;
}

// ─── Helper: invia a lista di token con pulizia stale ────────────────────

async function inviaATokens(tokens, msgBase, label) {
  if (!tokens.length) { console.warn(`[FCM] ${label}: nessun token.`); return; }
  const stale = [];
  const results = await Promise.all(tokens.map(async (token, idx) => {
    try {
      const id = await messaging.send({ ...msgBase, token });
      console.log(`[FCM] ✓ ${label} token[${idx}] — ${id}`);
      return { ok: true };
    } catch (err) {
      const code = err.code || String(err);
      console.error(`[FCM] ✗ ${label} token[${idx}] — ${code}: ${err.message}`);
      if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) stale.push(token);
      return { ok: false };
    }
  }));
  console.log(`[FCM] ${label} — OK: ${results.filter(r=>r.ok).length}, KO: ${results.filter(r=>!r.ok).length}`);
  // Pulizia token stale
  for (const st of stale) {
    for (const coll of ['utenti', 'staff', 'amici']) {
      try {
        const s1 = await db.collection(coll).where('fcmTokens', 'array-contains', st).get();
        for (const d of s1.docs) await d.ref.update({ fcmTokens: (d.data().fcmTokens||[]).filter(t=>t!==st) });
        const s2 = await db.collection(coll).where('fcmToken', '==', st).get();
        for (const d of s2.docs) await d.ref.update({ fcmToken: null });
      } catch (e) { console.warn(`[FCM] Pulizia stale ${coll}:`, e.message); }
    }
  }
}

// ─── TRIGGER 1: nuovo post nel diario → broadcast a tutti ────────────────

exports.onNuovoContenuto = onDocumentCreated(
  { document: 'diario/{postId}', region: 'europe-west1' },
  async event => {
    const postId = event.params.postId;
    const data   = event.data?.data();
    if (!data) return;
    if (!data.testo && !data.immagineUrl && !data.audioUrl && !data.videoUrl) return;

    const autoreUid = data.uidRagazzo;
    const anteprima = data.testo
      ? tronca(data.testo)
      : data.immagineUrl ? '📷 Ha condiviso una foto'
      : data.audioUrl    ? '🎙️ Ha condiviso un audio'
      : '🎬 Ha condiviso un video';
    const nomeAutore = await getNome(autoreUid);
    const profiloUrl = `/profilo.html?uid=${autoreUid}`;

    const msgBase = {
      notification: { title: '🗞️ Campo dei Fiori', body: `${nomeAutore}: ${anteprima}` },
      data: { url: profiloUrl, tag: `diario-${postId}` },
      webpush: {
        notification: { title: '🗞️ Campo dei Fiori', body: `${nomeAutore}: ${anteprima}`,
          icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: `diario-${postId}` },
        fcmOptions: { link: profiloUrl }
      },
      android: { notification: { sound: 'default', channelId: 'campo_notifiche' } },
      apns:    { payload: { aps: { sound: 'default', badge: 1 } } }
    };

    const tokens = await getAllFcmTokens(autoreUid);
    await inviaATokens(tokens, msgBase, `diario-${postId}`);
  }
);

// ─── TRIGGER 2: nuovo messaggio in bottiglia → solo al destinatario ───────

exports.onNuovaBottiglia = onDocumentCreated(
  { document: 'messaggiBottiglia/{bottigliaId}', region: 'europe-west1' },
  async event => {
    const bottigliaId = event.params.bottigliaId;
    const data        = event.data?.data();
    if (!data) return;

    const mittente    = data.uidMittente;
    const destinatario = data.uidDestinatario;
    if (!destinatario) { console.warn('[FCM] Bottiglia senza destinatario.'); return; }

    const nomeMittente  = data.nomeMittente || await getNome(mittente);
    const anteprima     = data.testo ? tronca(data.testo, 60)
      : data.audioUrl   ? '🎙️ Ha inviato un audio'
      : data.immagineUrl ? '📷 Ha inviato una foto'
      : data.videoUrl   ? '🎬 Ha inviato un video'
      : '✉️ Hai ricevuto un messaggio';
    const profiloUrl = `/profilo.html?uid=${destinatario}`;

    const msgBase = {
      notification: { title: `💌 ${nomeMittente} ti ha scritto`, body: anteprima },
      data: { url: profiloUrl, tag: `bottiglia-${bottigliaId}` },
      webpush: {
        notification: { title: `💌 ${nomeMittente} ti ha scritto`, body: anteprima,
          icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: `bottiglia-${bottigliaId}` },
        fcmOptions: { link: profiloUrl }
      },
      android: { notification: { sound: 'default', channelId: 'campo_notifiche' } },
      apns:    { payload: { aps: { sound: 'default' } } }
    };

    const tokens = await getTokensForUid(destinatario);
    await inviaATokens(tokens, msgBase, `bottiglia-${bottigliaId}`);
  }
);

// ─── TRIGGER 3: nuovo commento al diario → al proprietario del post ───────

exports.onNuovoCommento = onDocumentCreated(
  { document: 'diario/{postId}/commenti/{commentId}', region: 'europe-west1' },
  async event => {
    const { postId, commentId } = event.params;
    const commentData = event.data?.data();
    if (!commentData) return;

    const commentatoreUid = commentData.uidAutore;
    const nomeCommentatore = commentData.nomeAutore || await getNome(commentatoreUid);
    const testoCommento    = tronca(commentData.testo || commentData.trascrizione || '', 80);

    // Recupera proprietario del post
    const postSnap = await db.collection('diario').doc(postId).get();
    if (!postSnap.exists) return;
    const proprietarioUid = postSnap.data().uidRagazzo;

    // Non notificare se l'autore commenta il proprio post
    if (commentatoreUid === proprietarioUid) return;

    const profiloUrl = `/profilo.html?uid=${proprietarioUid}`;
    const msgBase = {
      notification: { title: `💬 ${nomeCommentatore} ha commentato`, body: testoCommento || 'Nuovo commento' },
      data: { url: profiloUrl, tag: `commento-${commentId}` },
      webpush: {
        notification: { title: `💬 ${nomeCommentatore} ha commentato`, body: testoCommento || 'Nuovo commento',
          icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: `commento-${commentId}` },
        fcmOptions: { link: profiloUrl }
      },
      android: { notification: { sound: 'default', channelId: 'campo_notifiche' } },
      apns:    { payload: { aps: { sound: 'default' } } }
    };

    const tokens = await getTokensForUid(proprietarioUid);
    await inviaATokens(tokens, msgBase, `commento-diario-${commentId}`);
  }
);

// ─── TRIGGER 4: nuovo commento a bottiglia → a mittente + destinatario ───

exports.onNuovoCommentoBott = onDocumentCreated(
  { document: 'messaggiBottiglia/{bottigliaId}/commenti/{commentId}', region: 'europe-west1' },
  async event => {
    const { bottigliaId, commentId } = event.params;
    const commentData = event.data?.data();
    if (!commentData) return;

    const commentatoreUid  = commentData.uidAutore;
    const nomeCommentatore = commentData.nomeAutore || await getNome(commentatoreUid);
    const testoCommento    = tronca(commentData.testo || '', 80);

    // Recupera mittente e destinatario della bottiglia
    const bottSnap = await db.collection('messaggiBottiglia').doc(bottigliaId).get();
    if (!bottSnap.exists) return;
    const { uidMittente, uidDestinatario } = bottSnap.data();

    // Destinatari = mittente + destinatario bottiglia, escluso il commentatore
    const destinatariUid = [uidMittente, uidDestinatario]
      .filter(uid => uid && uid !== commentatoreUid);
    const uniqueUid = [...new Set(destinatariUid)];

    const msgBase = {
      notification: { title: `💬 ${nomeCommentatore} ha risposto`, body: testoCommento || 'Nuovo commento in bottiglia' },
      data: { url: `/profilo.html?uid=${uidDestinatario}`, tag: `commento-bott-${commentId}` },
      webpush: {
        notification: { title: `💬 ${nomeCommentatore} ha risposto`, body: testoCommento || 'Nuovo commento in bottiglia',
          icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: `commento-bott-${commentId}` },
        fcmOptions: { link: `/profilo.html?uid=${uidDestinatario}` }
      },
      android: { notification: { sound: 'default', channelId: 'campo_notifiche' } },
      apns:    { payload: { aps: { sound: 'default' } } }
    };

    const allTokens = (await Promise.all(uniqueUid.map(getTokensForUid))).flat();
    const uniqueTokens = [...new Set(allTokens)];
    await inviaATokens(uniqueTokens, msgBase, `commento-bott-${commentId}`);
  }
);
