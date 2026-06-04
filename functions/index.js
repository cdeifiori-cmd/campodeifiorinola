/**
 * Cloud Functions — Campo dei Fiori
 *
 * ARCHITETTURA SEMPLIFICATA:
 * Un solo trigger: onNuovoContenuto
 *   → si attiva quando viene creato un documento in 'diario/{postId}'
 *   → invia notifica push a TUTTI gli utenti con fcmToken (utenti + staff + amici)
 *   → esclude l'autore del post dalla lista destinatari
 *
 * Il Giornale è un feed puramente client-side (non ha una collection dedicata).
 * La sorgente principale di nuovo contenuto è la collection 'diario'.
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp }     = require('firebase-admin/app');
const { getFirestore }      = require('firebase-admin/firestore');
const { getMessaging }      = require('firebase-admin/messaging');

// Inizializzazione sincrona a livello di modulo — corretta e attesa da Firebase
initializeApp();
const db        = getFirestore();
const messaging = getMessaging();

// ─── Helper: raccoglie tutti i token FCM da utenti, staff, amici ──────────

async function getAllFcmTokens(excludeUid = null) {
  console.log('[FCM] Raccolta token, escludo UID:', excludeUid);
  const tokens = [];

  for (const coll of ['utenti', 'staff', 'amici']) {
    try {
      const snap = await db.collection(coll).get();
      snap.forEach(docSnap => {
        if (docSnap.id === excludeUid) return;
        const d = docSnap.data();

        // Nuovo campo array (più dispositivi per utente)
        if (Array.isArray(d.fcmTokens)) {
          d.fcmTokens.forEach(t => {
            if (t && typeof t === 'string' && t.length > 10) tokens.push(t);
          });
        }
        // Vecchio campo stringa (backward compat — aggiunge se non già in array)
        if (d.fcmToken && typeof d.fcmToken === 'string' && d.fcmToken.length > 10) {
          tokens.push(d.fcmToken);
        }
      });
      console.log(`[FCM] Collezione '${coll}': ${snap.size} doc letti`);
    } catch (err) {
      console.error(`[FCM] Errore lettura '${coll}':`, err.message);
    }
  }

  const unique = [...new Set(tokens)];
  console.log(`[FCM] Token validi trovati: ${unique.length} (su ${tokens.length} totali)`);
  return unique;
}

// ─── Helper: nome autore ──────────────────────────────────────────────────

async function getNome(uid) {
  for (const coll of ['utenti', 'staff']) {
    try {
      const snap = await db.collection(coll).doc(uid).get();
      if (snap.exists) {
        const nome = snap.data().nome;
        if (nome) return nome;
      }
    } catch (_) {}
  }
  return 'Qualcuno';
}

function tronca(testo, max = 80) {
  if (!testo || typeof testo !== 'string') return '';
  return testo.length > max ? testo.slice(0, max) + '…' : testo;
}

// ─── TRIGGER 2: nuovo messaggio in bottiglia → broadcast a tutti ─────────

exports.onNuovaBottiglia = onDocumentCreated(
  { document: 'messaggiBottiglia/{bottigliaId}', region: 'europe-west1' },
  async event => {
    const bottigliaId = event.params.bottigliaId;
    console.log('[FCM] Trigger onNuovaBottiglia — id:', bottigliaId);

    const data = event.data?.data();
    if (!data) { console.warn('[FCM] Documento vuoto, uscita.'); return; }

    const mittente = data.uidMittente;
    console.log('[FCM] Mittente UID:', mittente);

    const tokens = await getAllFcmTokens(mittente); // escludi mittente
    if (!tokens.length) { console.warn('[FCM] Nessun token trovato.'); return; }

    const msgBase = {
      notification: { title: '💌 Nuovo messaggio in bottiglia', body: 'Qualcuno ti ha scritto su Campo dei Fiori' },
      data: { url: '/giornale.html', tag: `bottiglia-${bottigliaId}` }, // letto dal SW al click
      webpush: {
        notification: {
          title: '💌 Nuovo messaggio in bottiglia',
          body:  'Qualcuno ti ha scritto su Campo dei Fiori',
          icon:  '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag:   `bottiglia-${bottigliaId}`
        },
        fcmOptions: { link: '/giornale.html' }
      },
      android: { notification: { sound: 'default', channelId: 'campo_notifiche' } },
      apns:    { payload: { aps: { sound: 'default' } } }
    };

    console.log(`[FCM] Invio bottiglia a ${tokens.length} token...`);
    const staleTokens = [];
    const results = await Promise.all(
      tokens.map(async (token, idx) => {
        try {
          const msgId = await messaging.send({ ...msgBase, token });
          console.log(`[FCM] ✓ Token[${idx}] OK — ${msgId}`);
          return { success: true };
        } catch (err) {
          const code = err.code || String(err);
          console.error(`[FCM] ✗ Token[${idx}] ERRORE — ${code}: ${err.message}`);
          if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) {
            staleTokens.push(token);
          }
          return { success: false };
        }
      })
    );
    const ok = results.filter(r => r.success).length;
    console.log(`[FCM] Bottiglia completata — Successi: ${ok}, Falliti: ${results.length - ok}`);

    // Pulizia token stale
    for (const st of staleTokens) {
      for (const coll of ['utenti', 'staff', 'amici']) {
        try {
          const s = await db.collection(coll).where('fcmTokens', 'array-contains', st).get();
          for (const d of s.docs) { await d.ref.update({ fcmTokens: (d.data().fcmTokens||[]).filter(t=>t!==st) }); }
          const s2 = await db.collection(coll).where('fcmToken', '==', st).get();
          for (const d of s2.docs) { await d.ref.update({ fcmToken: null }); }
        } catch (e) { console.warn(`[FCM] Pulizia ${coll}:`, e.message); }
      }
    }
  }
);

// ─── TRIGGER 1: nuovo post nel diario → broadcast a tutti ────────────────

exports.onNuovoContenuto = onDocumentCreated(
  { document: 'diario/{postId}', region: 'europe-west1' },
  async event => {
    const postId = event.params.postId;
    console.log('[FCM] Trigger onNuovoContenuto — postId:', postId);

    const data = event.data?.data();
    if (!data) {
      console.warn('[FCM] Documento vuoto, uscita.');
      return;
    }

    const autoreUid = data.uidRagazzo;
    console.log('[FCM] Autore UID:', autoreUid);

    // Salta post senza contenuto reale
    if (!data.testo && !data.immagineUrl && !data.audioUrl && !data.videoUrl) {
      console.log('[FCM] Post senza contenuto, skip.');
      return;
    }

    // Anteprima testo per il body della notifica
    const anteprima = data.testo
      ? tronca(data.testo)
      : data.immagineUrl ? '📷 Ha condiviso una foto'
      : data.audioUrl    ? '🎙️ Ha condiviso un audio'
      : data.videoUrl    ? '🎬 Ha condiviso un video'
      : 'Nuovo contenuto!';

    // Nome autore
    const nomeAutore = await getNome(autoreUid);
    console.log('[FCM] Nome autore:', nomeAutore, '| Anteprima:', anteprima);

    // Raccogli tutti i token
    const tokens = await getAllFcmTokens(autoreUid);
    if (!tokens.length) {
      console.warn('[FCM] Nessun token trovato, nessuna notifica inviata.');
      return;
    }

    // Costruisci il messaggio
    const msgBase = {
      notification: {
        title: '🗞️ Campo dei Fiori',
        body:  `${nomeAutore}: ${anteprima}`
      },
      data: { url: '/giornale.html', tag: `giornale-${postId}` }, // letto dal SW al click
      webpush: {
        notification: {
          title:  '🗞️ Campo dei Fiori',
          body:   `${nomeAutore}: ${anteprima}`,
          icon:   '/icons/icon-192.png',
          badge:  '/icons/icon-192.png',
          tag:    `giornale-${postId}`
        },
        fcmOptions: { link: '/giornale.html' }
      },
      android: {
        notification: { sound: 'default', channelId: 'campo_notifiche' }
      },
      apns: {
        payload: { aps: { sound: 'default', badge: 1 } }
      }
    };

    // Invia a ogni token con messaging.send() individuale (più affidabile di sendEachForMulticast)
    // Promise.all invia tutti in parallelo senza bloccarsi su singoli errori
    console.log(`[FCM] Avvio invio a ${tokens.length} token in parallelo...`);

    const staleTokens = [];

    const results = await Promise.all(
      tokens.map(async (token, idx) => {
        try {
          console.log(`[FCM] Invio a token[${idx}]: ${token.slice(0,20)}…`);
          const msgId = await messaging.send({ ...msgBase, token });
          console.log(`[FCM] ✓ Token[${idx}] OK — messageId: ${msgId}`);
          return { success: true };
        } catch (err) {
          const code = err.code || err.errorInfo?.code || String(err);
          console.error(`[FCM] ✗ Token[${idx}] ERRORE — code: ${code} | msg: ${err.message}`);
          if (
            code.includes('registration-token-not-registered') ||
            code.includes('invalid-registration-token') ||
            code.includes('invalid-argument')
          ) {
            staleTokens.push(token);
          }
          return { success: false, code };
        }
      })
    );

    const totalSuccess = results.filter(r => r.success).length;
    const totalFail    = results.filter(r => !r.success).length;
    console.log(`[FCM] Completato — Successi: ${totalSuccess}, Falliti: ${totalFail}`);

    // Rimuovi token stale da tutte le collezioni
    if (staleTokens.length > 0) {
      console.log(`[FCM] Rimozione ${staleTokens.length} token stale da Firestore`);
      for (const staleToken of staleTokens) {
        for (const coll of ['utenti', 'staff', 'amici']) {
          try {
            const arrSnap = await db.collection(coll)
              .where('fcmTokens', 'array-contains', staleToken).get();
            for (const docSnap of arrSnap.docs) {
              const filtered = (docSnap.data().fcmTokens || []).filter(t => t !== staleToken);
              await docSnap.ref.update({ fcmTokens: filtered });
              console.log(`[FCM] Token stale rimosso array ${coll}/${docSnap.id}`);
            }
            const strSnap = await db.collection(coll)
              .where('fcmToken', '==', staleToken).get();
            for (const docSnap of strSnap.docs) {
              await docSnap.ref.update({ fcmToken: null });
              console.log(`[FCM] Token stale rimosso stringa ${coll}/${docSnap.id}`);
            }
          } catch (e) {
            console.warn(`[FCM] Errore pulizia ${coll}:`, e.message);
          }
        }
      }
    }
  }
);
