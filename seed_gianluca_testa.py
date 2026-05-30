import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

# 1. Aggiorna foto Sondes
db.collection('utenti').document('JUY3u00c4vNsxqzEMccl1aXU4A73').update({
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780160957/sondes_cartone_2_mj1jbb.png'
})
print('OK: foto Sondes aggiornata')

# 2. Aggiungi Gianluca Testa
ref = db.collection('utenti').document()
ref.set({
    'nome': 'Gianluca Testa',
    'email': '',
    'comunitaId': 'after-us',
    'fotoProfilo': '',
    'audioUrl': '',
    'miPresento': '',
    'autorizzato': False,
    'admin': False,
    'anteprima': True,
})
print(f'OK: Gianluca Testa aggiunto (after-us)')
print(f'ID documento: {ref.id}')
