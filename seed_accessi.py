import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

for coll in ['utenti', 'staff']:
    docs = db.collection(coll).stream()
    count = 0
    for doc in docs:
        data = doc.to_dict()
        if 'numeroAccessi' not in data:
            doc.reference.update({'numeroAccessi': 0})
            count += 1
    print(f'{coll}: {count} documenti aggiornati con numeroAccessi=0')

print('Fatto.')
