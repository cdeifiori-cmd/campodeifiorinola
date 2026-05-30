import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

uid = 'mCSgNMVEphVIIf4HX0bkcKq2ZKv2'

db.collection('staff').document(uid).set({
    'nome': 'Giacomo',
    'email': 'giacomo.desena@hotmail.it',
    'ruolo': 'educatore',
    'admin': True,
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780153581/io_giacomo_pastello_k6malj.png',
})
print('OK: Giacomo aggiunto alla collezione staff')
