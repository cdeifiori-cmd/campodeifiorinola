import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

ref = db.collection('utenti').document()
ref.set({
    'nome': 'Giuseppe',
    'email': '',
    'comunitaId': 'willy-coyote',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780211135/giuseppe_willy_d6ixwm.png',
    'audioUrl': '',
    'miPresento': '',
    'autorizzato': False,
    'admin': False,
    'anteprima': True,
})
print(f'OK: Giuseppe aggiunto a Firestore (willy-coyote)')
print(f'ID documento: {ref.id}')
