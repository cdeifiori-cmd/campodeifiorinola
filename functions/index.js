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
