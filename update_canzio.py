import firebase_admin
from firebase_admin import credentials, auth, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

AUTH_UID = 'KJS8JfRfKUOO3lmKOELFZiMdqqO2'
EMAIL    = 'canzio.re@icloud.com'
PASSWORD = 'canzio2026!'

# 1. Trova documento in collezione 'utenti' per nome
docs = list(db.collection('utenti').where('nome', '==', 'Canzio Re').stream())
if not docs:
    print('ERRORE: Canzio Re non trovato in utenti')
    exit(1)

doc = docs[0]
print(f'Trovato: {doc.id}')

# 2. Migra il documento al nuovo UID se necessario
if doc.id != AUTH_UID:
    print(f'Migro da {doc.id} a {AUTH_UID}...')
    data = doc.to_dict()
    data['anteprima'] = False
    data['autorizzato'] = True
    data['email'] = EMAIL
    db.collection('utenti').document(AUTH_UID).set(data)
    db.collection('utenti').document(doc.id).delete()
    print(f'Documento migrato a {AUTH_UID}')
else:
    db.collection('utenti').document(AUTH_UID).update({
        'anteprima': False,
        'autorizzato': True,
        'email': EMAIL,
    })
    print(f'Documento aggiornato ({AUTH_UID})')

# 3. Crea/aggiorna utente Firebase Auth
try:
    auth.create_user(uid=AUTH_UID, email=EMAIL, password=PASSWORD, display_name='Canzio Re')
    print('Auth creato: Canzio Re')
except auth.UidAlreadyExistsError:
    auth.update_user(AUTH_UID, email=EMAIL, password=PASSWORD, display_name='Canzio Re')
    print('Auth aggiornato: Canzio Re (UID gia esistente)')
except auth.EmailAlreadyExistsError:
    user = auth.get_user_by_email(EMAIL)
    auth.update_user(user.uid, password=PASSWORD)
    print('Auth aggiornato: Canzio Re (email gia esistente)')
except Exception as e:
    print(f'Auth ERRORE: {e}')

print('Done.')
