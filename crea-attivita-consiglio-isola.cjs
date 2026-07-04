// Crea il documento attivita "Il Consiglio dell'Isola" (sociogramma) e la sua prima rilevazione aperta.
// Uso: node crea-attivita-consiglio-isola.cjs
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const serviceAccount = require('./.firebase-service-account.json');

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const ADMIN_UID = 'mCSgNMVEphVIIf4HX0bkcKq2ZKv2';
const ATT_ID = 'consiglio-isola';

async function main() {
  const attRef = db.collection('attivita').doc(ATT_ID);
  const attSnap = await attRef.get();

  if (!attSnap.exists) {
    await attRef.set({
      tipo: 'sociogramma',
      titolo: "Il Consiglio dell'Isola",
      sottotitolo: 'Il sociogramma della ciurma',
      descrizione: "Ogni naufrago costruisce l'isola attraverso le relazioni che sceglie di creare. Rispondi a quattro domande per aiutare il Consiglio a capire come sta crescendo la nostra ciurma.",
      icona: '🏝',
      stato: 'attiva',
      ordine: 1,
      dataCreazione: FieldValue.serverTimestamp(),
      dataInizio: FieldValue.serverTimestamp(),
      dataFine: null,
      creatoDa: ADMIN_UID,
      config: {},
    });
    console.log(`✅ Creata attività: ${ATT_ID}`);
  } else {
    console.log(`ℹ️ Attività ${ATT_ID} già esistente, nessuna modifica.`);
  }

  const rilCollection = attRef.collection('rilevazioni');
  const rilSnap = await rilCollection.get();

  if (rilSnap.empty) {
    await rilCollection.add({
      numero: 1,
      data: FieldValue.serverTimestamp(),
      stato: 'aperta',
      sintesiPubblica: null,
    });
    console.log('✅ Creata rilevazione #1 (aperta)');
  } else {
    console.log(`ℹ️ Rilevazioni già presenti (${rilSnap.size}), nessuna modifica.`);
  }

  console.log('\n🏝 Setup del Consiglio dell\'Isola completato.');
  process.exit(0);
}

main().catch(err => { console.error('Errore:', err); process.exit(1); });
