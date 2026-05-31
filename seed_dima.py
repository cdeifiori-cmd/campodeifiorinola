import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

ref = db.collection('utenti').document()
ref.set({
    'nome': 'Dima',
    'email': '',
    'comunitaId': 'after-us',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780209496/dima_disegn_kngrrk.png',
    'audioUrl': '',
    'miPresento': '',
    'autorizzato': False,
    'admin': False,
    'anteprima': True,
})
print(f'OK: Dima aggiunto a Firestore (Follow Up / after-us)')
print(f'ID documento: {ref.id}')
