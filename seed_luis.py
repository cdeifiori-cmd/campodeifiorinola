import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

ref = db.collection('utenti').document()
ref.set({
    'nome': 'Luis',
    'email': '',
    'comunitaId': 'fortapasc',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780161141/Luis_q2bq9t.png',
    'audioUrl': '',
    'miPresento': '',
    'autorizzato': False,
    'admin': False,
    'anteprima': True,
})
print(f'OK: Luis aggiunto a Firestore (fortapasc)')
print(f'ID documento: {ref.id}')
