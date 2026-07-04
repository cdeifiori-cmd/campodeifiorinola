// Cancella le risposte di prova dal sociogramma "Il Consiglio dell'Isola" e
// riporta l'attività a una sola rilevazione aperta, vuota, numero 1.
// NON tocca il documento attivita/consiglio-isola (titolo, descrizione, ecc.).
// Uso: node svuota-risposte-consiglio-isola.cjs
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const serviceAccount = require('./.firebase-service-account.json');

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const ATT_ID = 'consiglio-isola';

// Soglia oltre la quale ci si ferma a chiedere conferma invece di cancellare
const SOGLIA_RILEVAZIONI = 5;
const SOGLIA_RISPOSTE_TOTALI = 30;

async function eliminaRisposte(rilRef) {
  const risposteSnap = await rilRef.collection('risposte').get();
  if (risposteSnap.empty) return 0;
  const batch = db.batch();
  risposteSnap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  return risposteSnap.size;
}

async function main() {
  const attRef = db.collection('attivita').doc(ATT_ID);
  const attSnap = await attRef.get();
  if (!attSnap.exists) {
    console.error(`❌ Attività ${ATT_ID} non trovata. Nessuna modifica effettuata.`);
    process.exit(1);
  }

  const rilSnap = await attRef.collection('rilevazioni').orderBy('numero', 'asc').get();
  const rilevazioni = [];
  for (const d of rilSnap.docs) {
    const risposteCountSnap = await d.ref.collection('risposte').get();
    rilevazioni.push({
      ref: d.ref,
      id: d.id,
      numero: d.data().numero,
      stato: d.data().stato,
      risposteCount: risposteCountSnap.size,
    });
  }

  console.log(`\n📋 Riepilogo rilevazioni di "${ATT_ID}":`);
  let totaleRisposte = 0;
  rilevazioni.forEach(r => {
    console.log(`  - #${r.numero} (id: ${r.id}) — stato: ${r.stato} — risposte: ${r.risposteCount}`);
    totaleRisposte += r.risposteCount;
  });
  console.log(`  Totale rilevazioni: ${rilevazioni.length} — Totale risposte: ${totaleRisposte}\n`);

  if (rilevazioni.length > SOGLIA_RILEVAZIONI || totaleRisposte > SOGLIA_RISPOSTE_TOTALI) {
    console.log('⚠️ Numero di rilevazioni/risposte più alto del previsto per delle prove.');
    console.log('   Mi fermo qui senza cancellare nulla: controlla il riepilogo sopra prima di procedere.');
    process.exit(0);
  }

  // Cancella tutte le risposte + azzera sintesiPubblica su ogni rilevazione
  let totaleCancellate = 0;
  for (const r of rilevazioni) {
    const n = await eliminaRisposte(r.ref);
    totaleCancellate += n;
    await r.ref.update({ sintesiPubblica: null });
    console.log(`🧹 Rilevazione #${r.numero}: cancellate ${n} risposte, sintesiPubblica azzerata.`);
  }

  // Riporta lo stato finale: una sola rilevazione, aperta, numero 1, vuota
  if (rilevazioni.length === 0) {
    await attRef.collection('rilevazioni').add({
      numero: 1,
      data: FieldValue.serverTimestamp(),
      stato: 'aperta',
      sintesiPubblica: null,
    });
    console.log('🆕 Nessuna rilevazione trovata: creata la rilevazione #1 (aperta, vuota).');
  } else {
    // Tieni la prima (per numero), riportala a numero 1 / aperta; elimina le altre
    const [daTenere, ...daEliminare] = rilevazioni;
    await daTenere.ref.update({
      numero: 1,
      stato: 'aperta',
      sintesiPubblica: null,
    });
    for (const r of daEliminare) {
      await r.ref.delete();
      console.log(`🗑️ Eliminata rilevazione #${r.numero} (id: ${r.id}) in eccesso.`);
    }
    console.log(`✅ Rilevazione ${daTenere.id} riportata a: numero 1, stato "aperta", vuota.`);
  }

  console.log(`\n🏝 Pulizia completata. Risposte di prova cancellate in totale: ${totaleCancellate}.`);
  process.exit(0);
}

main().catch(err => { console.error('Errore:', err); process.exit(1); });
