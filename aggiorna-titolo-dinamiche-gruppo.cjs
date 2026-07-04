// Rinomina l'attività "Il Consiglio dell'Isola" in "Dinamiche di gruppo" lato admin,
// mantenendo il nome narrativo per i naufraghi in titoloNarrativo. L'id documento resta invariato.
// Uso: node aggiorna-titolo-dinamiche-gruppo.cjs
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('./.firebase-service-account.json');

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const ATT_ID = 'consiglio-isola';

async function main() {
  const attRef = db.collection('attivita').doc(ATT_ID);
  const attSnap = await attRef.get();
  if (!attSnap.exists) {
    console.error(`❌ Attività ${ATT_ID} non trovata. Nessuna modifica effettuata.`);
    process.exit(1);
  }

  const prima = attSnap.data();
  console.log(`ℹ️ Titolo attuale: "${prima.titolo}"`);

  await attRef.update({
    titolo: 'Dinamiche di gruppo',
    titoloNarrativo: "Il Consiglio dell'Isola",
  });

  console.log('✅ Aggiornato: titolo = "Dinamiche di gruppo", titoloNarrativo = "Il Consiglio dell\'Isola"');
  console.log(`   (id documento invariato: ${ATT_ID})`);
  process.exit(0);
}

main().catch(err => { console.error('Errore:', err); process.exit(1); });
