import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

uid = '0u41pvwSTAaryAGWAG8gwuxrZ293'

db.collection('staff').document(uid).set({
    'nome': 'Massimo Allocca',
    'email': 'malocca@hotmail.it',
    'ruolo': 'educatore',
    'admin': False,
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780167967/ChatGPT_Image_30_mag_2026_21_05_27_ej4xxh.png',
    'autorizzato': True,
})
print('OK: Massimo Allocca aggiunto alla collezione staff')
