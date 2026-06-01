import firebase_admin
from firebase_admin import credentials, auth, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

uid = 'l7PpacmukqQSHRYhXxoP8zpWNnP2'

try:
    auth.create_user(uid=uid, email='libertivincenzo72@gmail.com', password='liberti2026!', display_name='Enzo Liberti')
    print('Auth creato: Enzo Liberti')
except auth.UidAlreadyExistsError:
    auth.update_user(uid, email='libertivincenzo72@gmail.com', password='liberti2026!', display_name='Enzo Liberti')
    print('Auth aggiornato: Enzo Liberti (UID gia esistente)')
except Exception as e:
    print(f'Auth ERRORE: {e}')

db.collection('staff').document(uid).set({
    'nome': 'Enzo Liberti',
    'email': 'libertivincenzo72@gmail.com',
    'ruolo': 'educatore',
    'comunitaId': 'bella-mbriana',
    'admin': False,
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780348964/enzo_cmjhmz.png',
    'autorizzato': True,
})
print('Firestore staff OK: Enzo Liberti')
