import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

# Genera ID documento casuale (no Firebase Auth UID)
ref = db.collection('utenti').document()
ref.set({
    'nome': 'Vincenzo Pannella',
    'email': '',
    'comunitaId': 'after-us',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780160991/vince_pannell_tffbkz.png',
    'audioUrl': '',
    'miPresento': '',
    'autorizzato': False,
    'admin': False,
    'anteprima': True,
})
print(f'OK: Vincenzo Pannella aggiunto a Firestore (after-us)')
print(f'ID documento: {ref.id}')
