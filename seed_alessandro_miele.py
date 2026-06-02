import firebase_admin
from firebase_admin import credentials, auth, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

AUTH_UID = 'lQP3Fs1v4BgjwWDdT1ffSBekHNm1'
EMAIL    = 'amiele379@libero.it'
PASSWORD = 'miele2026!'

# 1. Crea/aggiorna utente Firebase Auth
try:
    auth.create_user(uid=AUTH_UID, email=EMAIL, password=PASSWORD, display_name='Alessandro Miele')
    print('Auth creato: Alessandro Miele')
except auth.UidAlreadyExistsError:
    auth.update_user(AUTH_UID, email=EMAIL, password=PASSWORD, display_name='Alessandro Miele')
    print('Auth aggiornato: Alessandro Miele (UID gia esistente)')
except auth.EmailAlreadyExistsError:
    user = auth.get_user_by_email(EMAIL)
    auth.update_user(user.uid, password=PASSWORD)
    print('Auth aggiornato: Alessandro Miele (email gia esistente)')
except Exception as e:
    print(f'Auth ERRORE: {e}')

# 2. Crea documento Firestore con UID come document ID
db.collection('utenti').document(AUTH_UID).set({
    'nome': 'Alessandro Miele',
    'comunitaId': 'after-us',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780393415/ChatGPT_Image_2_giu_2026_11_43_13_wgbewn.png',
    'email': EMAIL,
    'anteprima': False,
    'autorizzato': True,
    'admin': False,
})
print(f'Firestore OK: Alessandro Miele (ID: {AUTH_UID})')
print('Done.')
