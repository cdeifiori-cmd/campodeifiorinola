import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

ref = db.collection('utenti').document()
ref.set({
    'nome': 'Emanuele',
    'email': '',
    'comunitaId': 'bella-mbriana',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780161109/emanuele_stnvej.png',
    'audioUrl': '',
    'miPresento': '',
    'autorizzato': False,
    'admin': False,
    'anteprima': True,
})
print(f'OK: Emanuele aggiunto a Firestore (bella-mbriana)')
print(f'ID documento: {ref.id}')
