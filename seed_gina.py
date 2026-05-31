import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

ref = db.collection('staff').document()
ref.set({
    'nome': 'Gina Graziano',
    'email': '',
    'ruolo': 'educatrice',
    'comunitaId': 'willy-coyote',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780214663/Gina_Graziano_eoe3jo.png',
    'admin': False,
    'autorizzato': False,
    'anteprima': True,
})
print(f'OK: Gina Graziano aggiunta allo staff (willy-coyote)')
print(f'ID documento: {ref.id}')
