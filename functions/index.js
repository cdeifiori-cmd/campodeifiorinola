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

// ─── UNICO TRIGGER: nuovo post nel diario → broadcast a tutti ────────────

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

    // Invia in batch da 500 (limite FCM)
    let totalSuccess = 0;
    let totalFail    = 0;

    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);
      console.log(`[FCM] Invio batch ${Math.floor(i/500)+1}: ${batch.length} token`);
      try {
        const result = await messaging.sendEachForMulticast({
          ...msgBase,
          tokens: batch
        });
        totalSuccess += result.successCount;
        totalFail    += result.failureCount;
        console.log(`[FCM] Batch OK: ${result.successCount} successi, ${result.failureCount} falliti`);

        // Logga errori e rimuove token stale/scaduti da Firestore
        const staleTokens = [];
        result.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const code = resp.error?.code || '';
            console.warn(`[FCM] Token [${idx}] fallito:`, code, resp.error?.message);
            // Token non più valido → va rimosso
            if (
              code === 'messaging/registration-token-not-registered' ||
              code === 'messaging/invalid-registration-token' ||
              code === 'messaging/invalid-argument'
            ) {
              staleTokens.push(batch[idx]);
            }
          }
        });

        // Rimuovi token stale da tutte le collezioni (array + vecchio campo stringa)
        if (staleTokens.length > 0) {
          console.log(`[FCM] Rimozione ${staleTokens.length} token stale da Firestore`);
          for (const staleToken of staleTokens) {
            for (const coll of ['utenti', 'staff', 'amici']) {
              try {
                // Cerca nel nuovo campo array
                const arrSnap = await db.collection(coll)
                  .where('fcmTokens', 'array-contains', staleToken).get();
                for (const docSnap of arrSnap.docs) {
                  const filtered = (docSnap.data().fcmTokens || []).filter(t => t !== staleToken);
                  await docSnap.ref.update({ fcmTokens: filtered });
                  console.log(`[FCM] Token stale rimosso dall'array in ${coll}/${docSnap.id}`);
                }
                // Cerca nel vecchio campo stringa
                const strSnap = await db.collection(coll)
                  .where('fcmToken', '==', staleToken).get();
                for (const docSnap of strSnap.docs) {
                  await docSnap.ref.update({ fcmToken: null });
                  console.log(`[FCM] Token stale (campo stringa) rimosso da ${coll}/${docSnap.id}`);
                }
              } catch (e) {
                console.warn(`[FCM] Errore pulizia token in ${coll}:`, e.message);
              }
            }
          }
        }
      } catch (err) {
        console.error('[FCM] Errore invio batch:', err.message);
        totalFail += batch.length;
      }
    }

    console.log(`[FCM] Completato — Successi: ${totalSuccess}, Falliti: ${totalFail}`);
  }
);
