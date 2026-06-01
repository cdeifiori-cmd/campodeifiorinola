import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

docs = db.collection('utenti').where('nome', '==', 'Ashik Sarder').stream()
found = False
for doc in docs:
    doc.reference.update({'comunitaId': 'fortapasc'})
    print(f'OK: Ashik Sarder (ID: {doc.id}) spostato in fortapasc')
    found = True

if not found:
    print('ERRORE: Ashik Sarder non trovato in Firestore!')
