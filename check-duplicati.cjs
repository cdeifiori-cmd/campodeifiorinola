const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('./.firebase-service-account.json');

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function run() {
  const snap = await db.collection('robinson_naufraghi').get();

  // Raggruppa per nome
  const perNome = {};
  snap.forEach(doc => {
    const d = doc.data();
    const nome = d.nome || '(senza nome)';
    if (!perNome[nome]) perNome[nome] = [];
    perNome[nome].push({ uid: doc.id, nome, fotoRobinson: d.fotoRobinson || '', fotoProfilo: d.fotoProfilo || '' });
  });

  console.log('\n=== DUPLICATI ===');
  const daEliminare = [];
  for (const [nome, docs] of Object.entries(perNome)) {
    if (docs.length > 1) {
      console.log(`\n👥 ${nome} (${docs.length} documenti):`);
      docs.forEach(d => {
        const hasFoto = !!d.fotoRobinson;
        console.log(`  ${hasFoto ? '✅ TIENI' : '❌ ELIMINA'}  ${d.uid}  fotoRobinson: ${d.fotoRobinson || '(vuota)'}`);
        if (!hasFoto) daEliminare.push(d);
      });
    }
  }

  if (daEliminare.length === 0) {
    console.log('Nessun duplicato da eliminare (tutti hanno fotoRobinson).');
    process.exit(0);
  }

  console.log('\n=== RIEPILOGO DA ELIMINARE ===');
  daEliminare.forEach(d => console.log('❌', d.uid, '→', d.nome));

  // Procedi con eliminazione
  console.log('\n=== ELIMINAZIONE ===');
  for (const d of daEliminare) {
    await db.collection('robinson_naufraghi').doc(d.uid).delete();
    console.log('🗑️  Eliminato:', d.uid, '→', d.nome);
  }

  const finalSnap = await db.collection('robinson_naufraghi').get();
  console.log('\n=== STATO FINALE (' + finalSnap.size + ') ===');
  finalSnap.forEach(doc => {
    const d = doc.data();
    console.log(' ', doc.id, '→', d.nome || '(senza nome)');
  });

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
