import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

ref = db.collection('staff').document()
ref.set({
    'nome': 'Federica',
    'email': '',
    'ruolo': 'educatrice',
    'comunitaId': 'bella-mbriana',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780213670/Federica_pb8gju.png',
    'admin': False,
    'autorizzato': False,
    'anteprima': True,
})
print(f'OK: Federica aggiunta allo staff')
print(f'ID documento: {ref.id}')
