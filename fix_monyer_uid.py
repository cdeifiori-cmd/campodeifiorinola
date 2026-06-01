import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

AUTH_UID  = 'dWH3Hzn1diUlZ41ZmiKijTiJrsW2'
OLD_QUERY = 'Monyer'

# 1. Trova il documento attuale di Monyer
docs = list(db.collection('utenti').where('nome', '==', OLD_QUERY).stream())
if not docs:
    print('ERRORE: nessun documento con nome "Monyer" trovato in utenti.')
    exit(1)

old_doc = docs[0]
old_id  = old_doc.id
data    = old_doc.to_dict()

print(f'Documento attuale: ID={old_id}')
print(f'Dati: {data}')

if old_id == AUTH_UID:
    print('Il documento ha gia il corretto UID come ID. Nessuna migrazione necessaria.')
    exit(0)

# 2. Crea nuovo documento con ID = AUTH_UID
new_ref = db.collection('utenti').document(AUTH_UID)
new_ref.set(data)
print(f'Nuovo documento creato con ID={AUTH_UID}')

# 3. Cancella il vecchio documento
db.collection('utenti').document(old_id).delete()
print(f'Vecchio documento {old_id} eliminato.')

print('Migrazione completata. Monyer ora usa UID Firebase come document ID.')
