#!/usr/bin/env node

/**
 * Script per aggiornare la foto profilo di Daniele Grande in Firestore
 *
 * IMPORTANTE: Questo script richiede le credenziali Firebase Admin.
 * Scaricare il file serviceAccountKey.json dalla Firebase Console:
 * 1. Vai su https://console.firebase.google.com/
 * 2. Seleziona il progetto "campo-dei-fiori"
 * 3. Impostazioni progetto → Account di servizio → Genera nuova chiave privata
 * 4. Salva il file come serviceAccountKey.json nella cartella di questo progetto
 * 5. Esegui: node update-daniele-foto.js
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Carica le credenziali
const credentialsPath = path.join(__dirname, 'serviceAccountKey.json');
if (!fs.existsSync(credentialsPath)) {
  console.error('❌ ERRORE: File serviceAccountKey.json non trovato!');
  console.error('Leggi le istruzioni nel commento sopra.');
  process.exit(1);
}

const serviceAccount = require(credentialsPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'campo-dei-fiori'
});

const db = admin.firestore();

const NUOVA_FOTO_URL = 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780161143/daniele_kdmioo.png';

async function updateDanielePhoto() {
  try {
    console.log('🔍 Cercando Daniele Grande nella collezione "utenti"...');

    // Cerca per nome
    const query = db.collection('utenti').where('nome', '==', 'Daniele Grande');
    const snapshot = await query.get();

    if (snapshot.empty) {
      console.error('❌ ERRORE: Daniele Grande non trovato nella collezione "utenti"');
      console.log('\nAlternative:');
      console.log('1. Verifica il nome esatto nel database');
      console.log('2. Se il nome è diverso, modifica la query nel script');
      process.exit(1);
    }

    if (snapshot.size > 1) {
      console.error('❌ ERRORE: Trovati più documenti con questo nome');
      process.exit(1);
    }

    const doc = snapshot.docs[0];
    const uid = doc.id;
    console.log(`✓ Trovato: ${doc.data().nome} (UID: ${uid})`);

    console.log(`\n📸 Aggiornamento foto profilo...`);
    console.log(`   Vecchia foto: ${doc.data().fotoProfilo || 'nessuna'}`);
    console.log(`   Nuova foto: ${NUOVA_FOTO_URL}`);

    await db.collection('utenti').doc(uid).update({
      fotoProfilo: NUOVA_FOTO_URL
    });

    console.log('\n✅ Foto profilo aggiornata con successo!');
    process.exit(0);
  } catch (error) {
    console.error('❌ ERRORE durante l\'aggiornamento:', error.message);
    process.exit(1);
  }
}

updateDanielePhoto();
