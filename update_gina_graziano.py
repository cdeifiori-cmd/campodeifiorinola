import firebase_admin
from firebase_admin import credentials, auth, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

AUTH_UID   = 'SzkJo0On7IQ3zsESpXOPICwFl7o1'
OLD_DOC_ID = 'ItvxJbKjcPe7wjJPPvMq'
EMAIL      = 'grazianogina62@libero.it'
PASSWORD   = 'graziano2026!'

# 1. Migra il documento staff al nuovo UID
if OLD_DOC_ID != AUTH_UID:
    print(f'Migro da {OLD_DOC_ID} a {AUTH_UID}...')
    snap = db.collection('staff').document(OLD_DOC_ID).get()
    if not snap.exists:
        print('ERRORE: documento non trovato')
        exit(1)
    data = snap.to_dict()
    data['anteprima'] = False
    data['autorizzato'] = True
    data['email'] = EMAIL
    db.collection('staff').document(AUTH_UID).set(data)
    db.collection('staff').document(OLD_DOC_ID).delete()
    print(f'Documento migrato a {AUTH_UID}')

# 2. Crea/aggiorna utente Firebase Auth
try:
    auth.create_user(uid=AUTH_UID, email=EMAIL, password=PASSWORD, display_name='Gina Graziano')
    print('Auth creato: Gina Graziano')
except auth.UidAlreadyExistsError:
    auth.update_user(AUTH_UID, email=EMAIL, password=PASSWORD, display_name='Gina Graziano')
    print('Auth aggiornato: Gina Graziano (UID gia esistente)')
except auth.EmailAlreadyExistsError:
    user = auth.get_user_by_email(EMAIL)
    auth.update_user(user.uid, password=PASSWORD)
    print('Auth aggiornato: Gina Graziano (email gia esistente)')
except Exception as e:
    print(f'Auth ERRORE: {e}')

print('Done.')
