import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

ref = db.collection('amici').document()
ref.set({
    'nome': 'Peppe Marotta',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780390998/ChatGPT_Image_2_giu_2026_11_02_44_wtjatq.png',
    'anteprima': True,
    'autorizzato': False,
})
print(f'OK: Peppe Marotta aggiunto alla collezione amici')
print(f'ID documento: {ref.id}')
