import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

ref = db.collection('utenti').document()
ref.set({
    'nome': 'Monyer',
    'email': '',
    'comunitaId': 'fortapasc',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780161111/monyer_h4a5fl.png',
    'audioUrl': 'https://dn721904.ca.archive.org/0/items/monyer-voce/monyer%20voce.mp3',
    'miPresento': '',
    'autorizzato': False,
    'admin': False,
    'anteprima': True,
})
print(f'OK: Monyer aggiunto a Firestore (fortapasc)')
print(f'ID documento: {ref.id}')
