// js/console/console-transfer.js
// Milestone D — operazione di TRASFERIMENTO di un ragazzo tra comunità
// (comunità→comunità, comunità→After Us, After Us→comunità: stessa operazione).
//
// Funzione DEDICATA: transferUtente(uid, destinazioneId, causale).
// NON esiste un updateUtente(uid, data) generico.
//
// Garanzie:
//  - UID invariato, nessun account creato, nessun documento ricreato
//  - transazione Firestore atomica: chiusura appartenenza precedente (o baseline
//    legacy) + nuova appartenenza aperta + utenti.comunitaId + admin_audit
//  - lo stato viene RILETTO dentro la transazione: due admin che trasferiscono
//    lo stesso ragazzo -> il secondo fallisce (nessun doppio record aperto,
//    nessuna doppia chiusura, comunitaId coerente)
//  - NON tocca PIN, foto, PPU, Storage, operatori
//  - NON sincronizza utenti_pin.comunitaId (campo write-only, non letto da
//    login/PIN/Functions: vedi CONSOLE-ADMIN-PLAN.md §Milestone D)

import { db, auth } from '../firebase-config.js';
import {
  doc, collection, getDoc, getDocs, query, where, runTransaction, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

export const CAUSALE_MAX = 500;
export const AFTER_US_ID = 'after-us';

/**
 * @param {string} uid            id del documento utenti/{uid}
 * @param {string} destinazioneId id del documento comunita/{id} di destinazione
 * @param {string} causale        motivazione amministrativa (obbligatoria, <= 500)
 * @returns {Promise<{uid, from: string|null, to: string, legacyBaseline: boolean,
 *                    closedAppartenenzaId: string|null, newAppartenenzaId: string, auditId: string}>}
 */
export async function transferUtente(uid, destinazioneId, causale) {
  // ── Validazione pura (prima di qualsiasi accesso a Firestore) ────────────
  if (typeof uid !== 'string' || !uid.trim()) throw new Error('uid del ragazzo mancante.');
  if (typeof destinazioneId !== 'string' || !destinazioneId.trim()) throw new Error('Comunità di destinazione mancante.');
  uid = uid.trim();
  destinazioneId = destinazioneId.trim();
  causale = String(causale == null ? '' : causale).trim();
  if (!causale) throw new Error('La causale è obbligatoria.');
  if (causale.length > CAUSALE_MAX) throw new Error(`La causale non può superare ${CAUSALE_MAX} caratteri.`);
  const actor = auth.currentUser;
  if (!actor) throw new Error('Sessione non autenticata.');

  // ── La destinazione DEVE esistere nella collezione canonica "comunita" ───
  const destSnap = await getDoc(doc(db, 'comunita', destinazioneId));
  if (!destSnap.exists()) {
    if (destinazioneId === AFTER_US_ID) {
      throw new Error(
        "Il documento canonico 'comunita/after-us' non esiste: trasferimento verso After Us BLOCCATO. " +
        "Crea prima il documento 'comunita/after-us'."
      );
    }
    throw new Error(`Comunità di destinazione "${destinazioneId}" non trovata nella collezione "comunita".`);
  }

  // ── Utente + comunità corrente ──────────────────────────────────────────
  const uSnap = await getDoc(doc(db, 'utenti', uid));
  if (!uSnap.exists()) throw new Error('Ragazzo non trovato nella collezione "utenti".');
  const beforeComunita = (typeof uSnap.data().comunitaId === 'string' && uSnap.data().comunitaId)
    ? uSnap.data().comunitaId : null;
  if (beforeComunita === destinazioneId) {
    throw new Error('Il ragazzo è già assegnato a questa comunità: nessun trasferimento necessario.');
  }

  // ── Appartenenza attualmente aperta (query FUORI dalla transazione;
  //    verrà ri-validata DENTRO la transazione) ─────────────────────────────
  const openSnap = await getDocs(query(
    collection(db, 'utenti', uid, 'appartenenze'), where('al', '==', null)
  ));
  if (openSnap.size > 1) {
    throw new Error(
      `Stato incoerente: risultano ${openSnap.size} appartenenze aperte per questo ragazzo. ` +
      `Serve una correzione manuale prima di poter trasferire.`
    );
  }
  const openRef = openSnap.empty ? null : openSnap.docs[0].ref;
  const isLegacy = !openRef; // nessuna appartenenza aperta = utente legacy (o mai storicizzato)

  // Reference con id generati ADESSO, usati dentro la transazione.
  const newApRef = doc(collection(db, 'utenti', uid, 'appartenenze'));
  const baselineRef = (isLegacy && beforeComunita)
    ? doc(collection(db, 'utenti', uid, 'appartenenze')) : null;
  const auditRef = doc(collection(db, 'admin_audit'));

  await runTransaction(db, async (tx) => {
    // Ri-lettura dello stato corrente DENTRO la transazione.
    const u = await tx.get(doc(db, 'utenti', uid));
    if (!u.exists()) throw new Error('Ragazzo non trovato (durante la transazione).');
    const cur = (typeof u.data().comunitaId === 'string' && u.data().comunitaId)
      ? u.data().comunitaId : null;
    if (cur !== beforeComunita) {
      throw new Error('Lo stato del ragazzo è cambiato durante l\'operazione. Ricarica e riprova.');
    }
    if (cur === destinazioneId) {
      throw new Error('Il ragazzo è già in questa comunità (cambiato durante l\'operazione).');
    }

    if (openRef) {
      const open = await tx.get(openRef);
      if (!open.exists() || open.data().al !== null) {
        throw new Error('L\'appartenenza aperta è cambiata durante l\'operazione. Ricarica e riprova.');
      }
      tx.update(openRef, { al: serverTimestamp() }); // chiusura ONE-WAY
    } else if (beforeComunita) {
      // Baseline legacy: record CHIUSO alla nascita, durata nulla (dal == al).
      // NON rappresenta un periodo reale: la data d'ingresso non è nota e
      // NON viene inventata (vedi commento in firestore.rules).
      tx.set(baselineRef, {
        comunitaId: beforeComunita,
        dal: serverTimestamp(),
        al: serverTimestamp(),
        causale: `baseline legacy — il ragazzo risultava in "${beforeComunita}" prima dell'introduzione dello storico (data d'ingresso non nota)`,
        actorUid: actor.uid,
        createdAt: serverTimestamp(),
        legacyBaseline: true,
      });
    }
    // Se isLegacy && !beforeComunita (nessuna comunità precedente): non si crea
    // baseline, si apre solo il nuovo record.

    // Nuova appartenenza APERTA verso la destinazione.
    tx.set(newApRef, {
      comunitaId: destinazioneId,
      dal: serverTimestamp(),
      al: null,
      causale,
      actorUid: actor.uid,
      createdAt: serverTimestamp(),
    });

    // Aggiorna SOLO utenti.comunitaId.
    tx.update(doc(db, 'utenti', uid), { comunitaId: destinazioneId });

    // Audit atomico.
    tx.set(auditRef, {
      ts: serverTimestamp(),
      actorUid: actor.uid,
      action: 'USER_COMMUNITY_TRANSFER',
      targetType: 'utente',
      targetId: uid,
      before: { comunitaId: beforeComunita },
      after: { comunitaId: destinazioneId },
      causale,
    });
  });

  return {
    uid,
    from: beforeComunita,
    to: destinazioneId,
    legacyBaseline: !!(isLegacy && beforeComunita),
    closedAppartenenzaId: openRef ? openRef.id : (baselineRef ? baselineRef.id : null),
    newAppartenenzaId: newApRef.id,
    auditId: auditRef.id,
  };
}
