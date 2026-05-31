import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

uid = 'vE8fBggEsOeAqcSoss9PEjVk2QY2'

db.collection('staff').document(uid).set({
    'nome': 'Gina Montanaro',
    'email': 'montanarogina28@gmail.com',
    'ruolo': 'educatrice',
    'comunita': 'Willy Coyote',
    'comunitaId': 'willy-coyote',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780222402/gina_montanaro_nrc2ag.png',
    'admin': False,
    'autorizzato': True,
    'anteprima': False,
})
print('OK: Gina Montanaro aggiunta allo staff (Willy Coyote)')
