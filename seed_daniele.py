import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

ref = db.collection('utenti').document()
ref.set({
    'nome': 'Daniele',
    'email': '',
    'comunitaId': 'bella-mbriana',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780161143/daniele_kdmioo.png',
    'audioUrl': 'https://dn721803.ca.archive.org/0/items/a-pizza-margheritaok/a%20pizza%20margheritaok.mp3',
    'miPresento': '',
    'autorizzato': False,
    'admin': False,
    'anteprima': True,
})
print(f'OK: Daniele aggiunto a Firestore (bella-mbriana)')
print(f'ID documento: {ref.id}')
