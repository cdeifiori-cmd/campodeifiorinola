import firebase_admin
from firebase_admin import credentials, firestore, auth

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

# Recupera UID da Firebase Auth tramite email
try:
    user = auth.get_user_by_email('fioragiannino88@gmail.com')
    uid = user.uid
    print(f'OK: UID trovato: {uid}')
except Exception as e:
    print(f'ERRORE: utente non trovato su Firebase Auth: {e}')
    exit(1)

# Crea documento in collezione utenti
db.collection('utenti').document(uid).set({
    'nome': 'Fiora',
    'email': 'fioragiannino88@gmail.com',
    'comunitaId': 'willy-coyote',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780935922/fiora_ykzziw.png',
    'audioUrl': '',
    'miPresento': '',
    'autorizzato': True,
    'admin': False,
    'anteprima': False,
})
print(f'OK: Fiora aggiunta a Firestore (willy-coyote), UID: {uid}')
