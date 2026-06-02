import firebase_admin
from firebase_admin import credentials, auth, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

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

# ── 1. Giovanni La Manna ──────────────────────────────────────────────────────
print('\n[1] Giovanni La Manna')
create_auth_user(
    uid='yp39YnGnUthal3jVUEvIeOktFbH3',
    email='lamannagiovanni2020@gmail.com',
    password='giovanni2026!',
    display_name='Giovanni La Manna',
)
db.collection('staff').document('yp39YnGnUthal3jVUEvIeOktFbH3').set({
    'nome': 'Giovanni La Manna',
    'email': 'lamannagiovanni2020@gmail.com',
    'ruolo': 'educatore',
    'comunitaId': 'itaca',
    'admin': False,
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780389183/ChatGPT_Image_2_giu_2026_10_13_59_tsta8h.png',
    'autorizzato': True,
})
print('  Firestore OK: Giovanni La Manna')

# ── 2. Marianna La Manna ─────────────────────────────────────────────────────
print('\n[2] Marianna La Manna')
create_auth_user(
    uid='urQW2rTUPmb1wWj72hm24UoXQDq2',
    email='mariannalamanna17@gmail.com',
    password='marianna2026!',
    display_name='Marianna La Manna',
)
db.collection('staff').document('urQW2rTUPmb1wWj72hm24UoXQDq2').set({
    'nome': 'Marianna La Manna',
    'email': 'mariannalamanna17@gmail.com',
    'ruolo': 'educatrice',
    'comunitaId': 'itaca',
    'admin': False,
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780389183/ChatGPT_Image_2_giu_2026_10_29_38_ycr6ov.png',
    'autorizzato': True,
})
print('  Firestore OK: Marianna La Manna')

print('\nDone.')
