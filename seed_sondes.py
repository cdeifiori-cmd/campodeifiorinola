import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

uid = 'JUY3u00c4vNsxqzEMccl1aXU4A73'

db.collection('utenti').document(uid).set({
    'nome': 'Sondes Kilani',
    'email': 'Kilanisondos806@gmail.com',
    'comunitaId': 'after-us',
    'fotoProfilo': '',
    'audioUrl': 'https://ia601309.us.archive.org/35/items/audio-sondes/audio%20sondes.mp3',
    'miPresento': '',
    'autorizzato': True,
    'admin': False,
    'anteprima': False,
})
print('OK: Sondes Kilani aggiunta a Firestore (after-us)')
