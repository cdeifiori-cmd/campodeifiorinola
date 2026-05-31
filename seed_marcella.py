import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

uid = 'Nvb8JFBe3JdnWp8FMgKwn755zxm1'

db.collection('staff').document(uid).set({
    'nome': 'Marcella Nappi',
    'email': 'Marcellanappi77@gmail.com',
    'ruolo': 'educatrice',
    'comunita': 'Bella Mbriana',
    'comunitaId': 'bella-mbriana',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780221857/Marcella_Bella_mbriana_oinucc.png',
    'admin': False,
    'autorizzato': True,
    'anteprima': False,
})
print('OK: Marcella Nappi aggiunta allo staff (Bella Mbriana)')
