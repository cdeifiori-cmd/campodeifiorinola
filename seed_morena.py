import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

uid = '7XSsVwZcOpUuTu8zkwW6X0qpJGW2'

db.collection('utenti').document(uid).set({
    'nome': 'Morena',
    'email': 'morenachierchiello10@gmail.com',
    'comunitaId': 'macrame',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780239415/morena_n07zuc.png',
    'audioUrl': '',
    'miPresento': '',
    'autorizzato': True,
    'admin': False,
    'anteprima': False,
})
print('OK: Morena aggiunta a Firestore (macrame)')
