import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

uid = 'jc9Wxl3PyUQ8EUWIHdtXS71cAiI2'

db.collection('utenti').document(uid).set({
    'nome': 'Salvatore',
    'email': 'salvatoremoxedano07@gmail.com',
    'comunitaId': 'macrame',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780161109/salvatore_ptjrhy.png',
    'audioUrl': 'https://dn721909.ca.archive.org/0/items/salvatore-si-scoccia/salvatore%20si%20scoccia.mp3',
    'miPresento': '',
    'autorizzato': True,
    'admin': False,
    'anteprima': False,
})
print('OK: Salvatore aggiunto a Firestore (macrame)')
