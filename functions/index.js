const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp }     = require('firebase-admin/app');
const { getFirestore }      = require('firebase-admin/firestore');
const { getMessaging }      = require('firebase-admin/messaging');

initializeApp();
const db        = getFirestore();
const messaging = getMessaging();

// ─── Helpers ───────────────────────────────────────────────────────────────

async function getFcmToken(uid) {
  for (const coll of ['utenti', 'staff']) {
    const snap = await db.collection(coll).doc(uid).get();
    if (snap.exists) {
      const token = snap.data().fcmToken;
      if (token) return token;
    }
  }
  return null;
}

// Raccoglie tutti i token FCM validi da utenti, staff e amici
// excludeUid: non include il token dell'autore del post
async function getAllFcmTokens(excludeUid = null) {
  const tokens = [];
  for (const coll of ['utenti', 'staff', 'amici']) {
    const snap = await db.collection(coll).get();
    snap.forEach(docSnap => {
      if (docSnap.id !== excludeUid) {
        const token = docSnap.data().fcmToken;
        if (token) tokens.push(token);
      }
    });
  }
  return [...new Set(tokens)]; // rimuovi eventuali duplicati
}

async function getNome(uid) {
  for (const coll of ['utenti', 'staff']) {
    const snap = await db.collection(coll).doc(uid).get();
    if (snap.exists) return snap.data().nome || 'Qualcuno';
  }
  return 'Qualcuno';
}

function tronca(testo, max = 80) {
  if (!testo) return '';
  return testo.length > max ? testo.slice(0, max) + '…' : testo;
}

async function invia({ token, title, body, url, tag }) {
  if (!token) return;
  await messaging.send({
    token,
    notification: { title, body },
    webpush: {
      notification: { title, body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag },
      fcmOptions: { link: url }
    },
    android: { notification: { sound: 'default', channelId: 'campo_notifiche' } },
    apns: { payload: { aps: { sound: 'default', badge: 1 } } }
  });
}

// ─── Trigger 1: Messaggio in bottiglia ────────────────────────────────────

exports.onNuovaBottiglia = onDocumentCreated(
  'messaggiBottiglia/{bottId}',
  async event => {
    const data      = event.data.data();
    const destUid   = data.uidDestinatario;
    const mittente  = data.nomeMittente || await getNome(data.uidMittente);
    const anteprima = tronca(data.testo || (data.immagineUrl ? '📷 Foto' : data.audioUrl ? '🎙️ Audio' : ''));

    const token = await getFcmToken(destUid);
    await invia({
      token,
      title: `🍾 Messaggio da ${mittente}`,
      body:  anteprima || 'Hai ricevuto un messaggio in bottiglia!',
      url:   `/profilo.html?uid=${destUid}#bottiglia-${event.params.bottId}`,
      tag:   `bottiglia-${event.params.bottId}`
    });
  }
);

// ─── Trigger 2: Commento su post del diario ───────────────────────────────

exports.onNuovoCommentoDiario = onDocumentCreated(
  'diario/{postId}/commenti/{commentId}',
  async event => {
    const commento = event.data.data();
    const postId   = event.params.postId;

    const postSnap = await db.collection('diario').doc(postId).get();
    if (!postSnap.exists) return;
    const destUid   = postSnap.data().uidRagazzo;
    if (destUid === commento.uidAutore) return; // non notificare l'owner che commenta se stesso

    const mittente  = commento.nomeAutore || await getNome(commento.uidAutore);
    const anteprima = tronca(commento.testo);

    const token = await getFcmToken(destUid);
    await invia({
      token,
      title: `💬 ${mittente} ha commentato`,
      body:  anteprima || 'Nuovo commento nel tuo diario!',
      url:   `/profilo.html?uid=${destUid}#post-${postId}`,
      tag:   `commento-diario-${postId}`
    });
  }
);

// ─── Trigger 4: Nuovo post nel Giornale (diario) — broadcast a tutti ─────
// Il Giornale è un feed client-side aggregato; la collezione sorgente è 'diario'.
// Quando un ragazzo/a pubblica un nuovo post, tutti gli utenti registrati
// ricevono una notifica push.

exports.onNuovoPostGiornale = onDocumentCreated(
  'diario/{postId}',
  async event => {
    const data      = event.data.data();
    const postId    = event.params.postId;
    const autoreUid = data.uidRagazzo;

    // Salta post senza contenuto (es. draft non completati)
    if (!data.testo && !data.immagineUrl && !data.audioUrl && !data.videoUrl) return;

    const nomeAutore = await getNome(autoreUid);
    const anteprima  = data.testo
      ? tronca(data.testo)
      : data.immagineUrl ? '📷 Ha condiviso una foto'
      : data.audioUrl    ? '🎙️ Ha condiviso un audio'
      : data.videoUrl    ? '🎬 Ha condiviso un video'
      : 'Nuovo contenuto nel giornale!';

    const tokens = await getAllFcmTokens(autoreUid);
    if (!tokens.length) return;

    const msgBase = {
      notification: {
        title: '🗞️ Campo dei Fiori',
        body:  `${nomeAutore}: ${anteprima}`
      },
      webpush: {
        notification: {
          title: '🗞️ Campo dei Fiori',
          body:  `${nomeAutore}: ${anteprima}`,
          icon:  '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag:   `giornale-${postId}`
        },
        fcmOptions: { link: '/giornale.html' }
      },
      android: { notification: { sound: 'default', channelId: 'campo_notifiche' } },
      apns:    { payload: { aps: { sound: 'default', badge: 1 } } }
    };

    // FCM accetta max 500 token per chiamata multicast
    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);
      await messaging.sendEachForMulticast({ ...msgBase, tokens: batch });
    }
  }
);

// ─── Trigger 3: Commento su messaggio in bottiglia ────────────────────────

exports.onNuovoCommentoBottiglia = onDocumentCreated(
  'messaggiBottiglia/{bottId}/commenti/{commentId}',
  async event => {
    const commento = event.data.data();
    const bottId   = event.params.bottId;

    const bottSnap = await db.collection('messaggiBottiglia').doc(bottId).get();
    if (!bottSnap.exists) return;
    const destUid   = bottSnap.data().uidDestinatario;
    if (destUid === commento.uidAutore) return;

    const mittente  = commento.nomeAutore || await getNome(commento.uidAutore);
    const anteprima = tronca(commento.testo);

    const token = await getFcmToken(destUid);
    await invia({
      token,
      title: `💬 ${mittente} ha commentato`,
      body:  anteprima || 'Nuovo commento sul tuo messaggio in bottiglia!',
      url:   `/profilo.html?uid=${destUid}#bottiglia-${bottId}`,
      tag:   `commento-bottiglia-${bottId}`
    });
  }
);
