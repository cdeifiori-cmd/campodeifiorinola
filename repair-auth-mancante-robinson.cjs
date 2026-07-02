// Script una-tantum: ripara naufraghi Robinson il cui documento robinson_pin
// esiste su Firestore ma a cui manca il relativo account Firebase Auth
// (causa: admin-pin.html riusava uid di profili 'utenti' preesistenti senza
// verificare che avessero un account Auth, es. profili importati da CSV/seed
// senza mai passare da un signUp). Crea l'account Auth con lo STESSO uid già
// presente nei documenti Firestore, cosi' non serve toccare nessun altro dato
// (robinson_pin, robinson_pin_lookup, robinson_naufraghi, utenti restano invariati).
//
// Uso: node repair-auth-mancante-robinson.cjs
// Sicuro da rilanciare piu' volte: salta i naufraghi il cui account Auth esiste gia'.

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

initializeApp({ credential: cert('./.firebase-service-account.json') });
const db = getFirestore();
const auth = getAuth();

async function run() {
  const pinSnap = await db.collection('robinson_pin').get();
  console.log(`Controllo ${pinSnap.size} naufraghi in robinson_pin...\n`);

  let riparati = 0;

  for (const d of pinSnap.docs) {
    const data = d.data();
    const uid = data.uid || d.id;
    const email = data.email;
    const pin = data.pin;
    const password = 'RR' + pin;
    const nome = data.nome || '(senza nome)';

    try {
      await auth.getUser(uid);
      // Account Auth già presente: nulla da fare
      continue;
    } catch (e) {
      if (e.code !== 'auth/user-not-found') {
        console.error(`❌ ${nome}: errore inatteso nel controllo Auth: ${e.message}`);
        continue;
      }
    }

    // Manca l'account Auth: lo creiamo con lo stesso uid già usato su Firestore
    try {
      await auth.createUser({ uid, email, password, displayName: nome });
      console.log(`✅ Creato account Auth per ${nome} (uid=${uid}, email=${email}, pin=${pin})`);
      riparati++;
    } catch (e) {
      console.error(`❌ ${nome}: impossibile creare account Auth: ${e.code} ${e.message}`);
    }
  }

  console.log(`\nCompletato. Account Auth riparati: ${riparati}`);
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
