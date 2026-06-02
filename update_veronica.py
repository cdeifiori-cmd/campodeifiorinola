import firebase_admin
from firebase_admin import credentials, auth, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

AUTH_UID = 'zrG4auHvFHS28V8C4WUiCGjs4HU2'
EMAIL    = 'veronicabellopede16@gmail.com'
PASSWORD = 'veronica2026!'

# 1. Trova documento in collezione 'utenti' per nome
docs = list(db.collection('utenti').where('nome', '==', 'Veronica Bellopede').stream())
if not docs:
    print('ERRORE: Veronica Bellopede non trovata in utenti')
    exit(1)

doc = docs[0]
print(f'Trovata: {doc.id}')

# 2. Aggiorna documento: sposta UID, aggiorna campi
#    Se il doc ID corrente non coincide con l'AUTH_UID, migra il documento
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
    auth.create_user(uid=AUTH_UID, email=EMAIL, password=PASSWORD, display_name='Veronica Bellopede')
    print('Auth creato: Veronica Bellopede')
except auth.UidAlreadyExistsError:
    auth.update_user(AUTH_UID, email=EMAIL, password=PASSWORD, display_name='Veronica Bellopede')
    print('Auth aggiornato: Veronica Bellopede (UID gia esistente)')
except auth.EmailAlreadyExistsError:
    user = auth.get_user_by_email(EMAIL)
    auth.update_user(user.uid, password=PASSWORD)
    print('Auth aggiornato: Veronica Bellopede (email gia esistente)')
except Exception as e:
    print(f'Auth ERRORE: {e}')

print('Done.')
