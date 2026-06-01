"""
Migra i documenti utenti il cui document ID non coincide con l'UID Firebase Auth.
"""
import firebase_admin
from firebase_admin import credentials, auth, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

def migra(nome, old_id, auth_uid):
    old_ref = db.collection('utenti').document(old_id)
    new_ref = db.collection('utenti').document(auth_uid)

    if old_id == auth_uid:
        print(f'{nome}: doc ID gia corretto ({auth_uid}). Skip.')
        return

    data = old_ref.get().to_dict()
    if not data:
        print(f'{nome}: documento {old_id} non trovato!')
        return

    new_ref.set(data)
    old_ref.delete()
    print(f'{nome}: migrato da {old_id} a {auth_uid}')

# Luis
migra('Luis', 'n7wX4D5IXLLMxRl0J4mI', 'qtuFj75xCFWNiYuItlh9WXtAjPg2')

# Verifica tutti gli altri utenti con email per trovare eventuali altri mismatch
print('\n--- Verifica altri utenti ---')
docs = db.collection('utenti').stream()
for doc in docs:
    data = doc.to_dict()
    email = data.get('email', '')
    if not email:
        continue
    try:
        auth_user = auth.get_user_by_email(email)
        if auth_user.uid != doc.id:
            print(f'MISMATCH: {data.get("nome")} | doc_id={doc.id} | auth_uid={auth_user.uid}')
        else:
            print(f'OK: {data.get("nome")} ({doc.id})')
    except auth.UserNotFoundError:
        pass  # nessun account Auth, normale
    except Exception as e:
        print(f'Errore per {data.get("nome")}: {e}')

print('\nFatto.')
