import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

uid = 'XZGdhGkIv5NuRvAFNN7PS3P8Kgp2'

db.collection('staff').document(uid).set({
    'nome': 'Annalisa Nunziata',
    'email': 'lisa-1988@hotmail.it',
    'ruolo': 'educatrice',
    'admin': False,
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780208843/annalisa_dxdgzo.png',
    'autorizzato': True,
})
print('OK: Annalisa Nunziata aggiunta alla collezione staff')
