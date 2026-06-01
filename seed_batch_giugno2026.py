import firebase_admin
from firebase_admin import credentials, auth, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db   = firestore.client()

errors = []

def create_auth_user(uid, email, password, display_name):
    try:
        auth.create_user(uid=uid, email=email, password=password, display_name=display_name)
        print(f'  Auth OK: {display_name} ({email})')
    except auth.UidAlreadyExistsError:
        print(f'  Auth: UID già esistente per {display_name}, aggiorno...')
        auth.update_user(uid, email=email, password=password, display_name=display_name)
    except auth.EmailAlreadyExistsError:
        print(f'  Auth: email già esistente per {display_name}, aggiorno password...')
        user = auth.get_user_by_email(email)
        auth.update_user(user.uid, password=password)
    except Exception as e:
        print(f'  Auth ERRORE per {display_name}: {e}')
        errors.append(f'Auth {display_name}: {e}')

# ────────────────────────────────────────────
# 1. STAFF – Fabiana Cimmino
# ────────────────────────────────────────────
print('\n[1] Fabiana Cimmino')
create_auth_user(
    uid='NCrbHMc7kvV4xsXQSoxrxTTtLUJ2',
    email='fabycimmino.fc@gmail.com',
    password='fabiana2026!',
    display_name='Fabiana Cimmino'
)
db.collection('staff').document('NCrbHMc7kvV4xsXQSoxrxTTtLUJ2').set({
    'nome': 'Fabiana Cimmino',
    'email': 'fabycimmino.fc@gmail.com',
    'ruolo': 'educatore',
    'admin': False,
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780333542/fabiana_nfcc1b.png',
    'autorizzato': True,
})
print('  Firestore staff OK: Fabiana Cimmino')

# ────────────────────────────────────────────
# 2. STAFF – Olimpia
# ────────────────────────────────────────────
print('\n[2] Olimpia')
create_auth_user(
    uid='E9Ujxzk8N0Vh87ZQgK1QT9NOTxv2',
    email='iossaoli@gmail.com',
    password='olimpia2026!',
    display_name='Olimpia'
)
db.collection('staff').document('E9Ujxzk8N0Vh87ZQgK1QT9NOTxv2').set({
    'nome': 'Olimpia',
    'email': 'iossaoli@gmail.com',
    'ruolo': 'educatore',
    'admin': False,
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780330881/olimpia_szdvy8.png',
    'autorizzato': True,
})
print('  Firestore staff OK: Olimpia')

# ────────────────────────────────────────────
# 3. STAFF – Giulia Nappo
# ────────────────────────────────────────────
print('\n[3] Giulia Nappo')
create_auth_user(
    uid='QTi0Jw6zxTX7fnRyZUVgEFmxIr02',
    email='nappogiulia77@gmail.com',
    password='giulia2026!',
    display_name='Giulia Nappo'
)
db.collection('staff').document('QTi0Jw6zxTX7fnRyZUVgEFmxIr02').set({
    'nome': 'Giulia Nappo',
    'email': 'nappogiulia77@gmail.com',
    'ruolo': 'educatore',
    'admin': False,
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780330715/Giulia_poqnym.png',
    'autorizzato': True,
})
print('  Firestore staff OK: Giulia Nappo')

# ────────────────────────────────────────────
# 4. AFTER US – Rayen (anteprima)
# ────────────────────────────────────────────
print('\n[4] Rayen (After Us, anteprima)')
ref_rayen = db.collection('utenti').document()
ref_rayen.set({
    'nome': 'Rayen',
    'email': '',
    'comunitaId': 'after-us',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780242286/Rayen_cpdqeb.png',
    'audioUrl': '',
    'miPresento': '',
    'autorizzato': False,
    'admin': False,
    'anteprima': True,
})
print(f'  Firestore utenti OK: Rayen (ID: {ref_rayen.id})')

# ────────────────────────────────────────────
# 5. FORTAPASC – Mohamed (anteprima)
# ────────────────────────────────────────────
print('\n[5] Mohamed (Fortapasc, anteprima)')
ref_mohamed = db.collection('utenti').document()
ref_mohamed.set({
    'nome': 'Mohamed',
    'email': '',
    'comunitaId': 'fortapasc',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780347299/Mohamed_z9hk0p.png',
    'audioUrl': '',
    'miPresento': '',
    'autorizzato': False,
    'admin': False,
    'anteprima': True,
})
print(f'  Firestore utenti OK: Mohamed (ID: {ref_mohamed.id})')

# ────────────────────────────────────────────
# 6. FORTAPASC – Ala Eddine (anteprima)
# ────────────────────────────────────────────
print('\n[6] Ala Eddine (Fortapasc, anteprima)')
ref_ala = db.collection('utenti').document()
ref_ala.set({
    'nome': 'Ala Eddine',
    'email': '',
    'comunitaId': 'fortapasc',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780347380/Ala_eddine_ola3ut.png',
    'audioUrl': '',
    'miPresento': '',
    'autorizzato': False,
    'admin': False,
    'anteprima': True,
})
print(f'  Firestore utenti OK: Ala Eddine (ID: {ref_ala.id})')

# ────────────────────────────────────────────
# 7. MONYER – promuovi + crea Auth
# ────────────────────────────────────────────
print('\n[7] Monyer (Fortapasc) – promuovi + crea Auth')

# Trova il documento di Monyer
monyer_docs = db.collection('utenti').where('nome', '==', 'Monyer').stream()
monyer_ref = None
for doc in monyer_docs:
    monyer_ref = doc.reference
    print(f'  Trovato Monyer: ID = {doc.id}')
    break

if monyer_ref:
    monyer_ref.update({
        'autorizzato': True,
        'anteprima': False,
        'email': 'carusomonyer34@gmail.com',
    })
    print('  Firestore utenti aggiornato: Monyer')
else:
    print('  ATTENZIONE: documento Monyer non trovato in Firestore!')
    errors.append('Monyer: documento non trovato')

# Crea utente Auth per Monyer
create_auth_user(
    uid='dWH3Hzn1diUlZ41ZmiKijTiJrsW2',
    email='carusomonyer34@gmail.com',
    password='monyer2026!',
    display_name='Monyer'
)

# ────────────────────────────────────────────
print('\n══════════════════════════════════════')
if errors:
    print(f'COMPLETATO CON {len(errors)} ERRORE/I:')
    for e in errors:
        print(f'  - {e}')
else:
    print('TUTTO COMPLETATO SENZA ERRORI ✓')
