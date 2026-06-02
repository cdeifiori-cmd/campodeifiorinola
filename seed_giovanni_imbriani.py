import firebase_admin
from firebase_admin import credentials, auth, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

AUTH_UID = 'NpWK3uDqDOU1CC841toszbeVh9G3'
EMAIL    = 'Imbrianigiovanni7@gmail.com'
PASSWORD = 'imbriani2026!'

try:
    auth.create_user(uid=AUTH_UID, email=EMAIL, password=PASSWORD, display_name='Giovanni Imbriani')
    print('Auth creato: Giovanni Imbriani')
except auth.UidAlreadyExistsError:
    auth.update_user(AUTH_UID, email=EMAIL, password=PASSWORD, display_name='Giovanni Imbriani')
    print('Auth aggiornato: Giovanni Imbriani (UID gia esistente)')
except auth.EmailAlreadyExistsError:
    user = auth.get_user_by_email(EMAIL)
    auth.update_user(user.uid, password=PASSWORD)
    print('Auth aggiornato: Giovanni Imbriani (email gia esistente)')
except Exception as e:
    print(f'Auth ERRORE: {e}')

db.collection('utenti').document(AUTH_UID).set({
    'nome': 'Giovanni Imbriani',
    'comunitaId': 'after-us',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780394333/imbriani_su1ciz.png',
    'email': EMAIL,
    'anteprima': False,
    'autorizzato': True,
    'admin': False,
})
print(f'Firestore OK: Giovanni Imbriani (ID: {AUTH_UID})')
print('Done.')
