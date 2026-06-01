import firebase_admin
from firebase_admin import credentials, auth, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

# Trova Luis in Firestore
docs = db.collection('utenti').where('nome', '==', 'Luis').stream()
luis_ref = None
for doc in docs:
    luis_ref = doc.reference
    print(f'Trovato Luis: ID = {doc.id}')
    break

if luis_ref:
    luis_ref.update({
        'autorizzato': True,
        'anteprima': False,
        'email': 'luisnikolic172@gmail.com',
    })
    print('Firestore aggiornato: Luis')
else:
    print('ERRORE: Luis non trovato in Firestore!')

# Crea/aggiorna utente Auth
try:
    auth.create_user(
        uid='qtuFj75xCFWNiYuItlh9WXtAjPg2',
        email='luisnikolic172@gmail.com',
        password='luis2026!',
        display_name='Luis'
    )
    print('Auth creato: Luis')
except auth.UidAlreadyExistsError:
    auth.update_user('qtuFj75xCFWNiYuItlh9WXtAjPg2', email='luisnikolic172@gmail.com', password='luis2026!', display_name='Luis')
    print('Auth aggiornato: Luis (UID gia esistente)')
except auth.EmailAlreadyExistsError:
    user = auth.get_user_by_email('luisnikolic172@gmail.com')
    auth.update_user(user.uid, password='luis2026!')
    print('Auth aggiornato: Luis (email gia esistente)')
except Exception as e:
    print(f'Auth ERRORE: {e}')

print('Fatto.')
