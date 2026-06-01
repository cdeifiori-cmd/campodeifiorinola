import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

INTERAZIONI_DEFAULT = {
    'diarioScritti': 0,
    'bottigliaInviati': 0,
    'bottigliaRicevuti': 0,
    'reazioniDate': 0,
    'reazioniRicevute': 0,
    'commentiScritti': 0,
    'commentiRicevuti': 0,
    'audioRegistrati': 0,
    'fotoCaricate': 0,
}

for coll in ['utenti', 'staff']:
    docs = db.collection(coll).stream()
    count = 0
    for doc in docs:
        data = doc.to_dict()
        if 'interazioni' not in data:
            doc.reference.update({'interazioni': INTERAZIONI_DEFAULT})
            count += 1
    print(f'{coll}: {count} documenti aggiornati con interazioni=0')

print('Fatto.')
