import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

ref = db.collection('utenti').document()
ref.set({
    'nome': 'Emanuele P',
    'email': '',
    'comunitaId': 'bella-mbriana',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780211147/emanuele_p_axggmr.png',
    'audioUrl': '',
    'miPresento': '',
    'autorizzato': False,
    'admin': False,
    'anteprima': True,
})
print(f'OK: Emanuele P aggiunto a Firestore (bella-mbriana)')
print(f'ID documento: {ref.id}')
