import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

uid = 'mU9S8OldUjeHYwQbQ1qWPVQOwqQ2'

db.collection('utenti').document(uid).set({
    'nome': 'Sara',
    'email': 'saraevan825@gmail.com',
    'comunitaId': 'after-us',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780158986/sara_zpvxpl.png',
    'audioUrl': 'https://dn710204.ca.archive.org/0/items/sara-voce/sara%20voce.mp3',
    'miPresento': '',
    'autorizzato': True,
    'admin': False,
})
print('OK: Sara aggiunta a Firestore (after-us)')
