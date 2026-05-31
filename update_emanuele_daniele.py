import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

def migra_utente(nome, comunita_id, nuovo_uid, update_fields):
    # Cerca il documento esistente
    q = db.collection('utenti').where('nome', '==', nome).get()
    trovato = None
    for d in q:
        data = d.to_dict()
        if comunita_id is None or data.get('comunitaId') == comunita_id:
            trovato = d
            break

    if not trovato:
        print(f'ERRORE: documento "{nome}" non trovato')
        return

    old_id = trovato.id
    old_data = trovato.to_dict()

    # Merge con i nuovi campi
    new_data = {**old_data, **update_fields}

    # Crea il nuovo documento con il nuovo UID
    db.collection('utenti').document(nuovo_uid).set(new_data)
    print(f'OK: creato {nome} con UID {nuovo_uid}')

    # Cancella il vecchio documento se diverso
    if old_id != nuovo_uid:
        db.collection('utenti').document(old_id).delete()
        print(f'OK: cancellato vecchio documento {old_id}')

# 1. Emanuele S
migra_utente(
    nome='Emanuele S',
    comunita_id=None,
    nuovo_uid='cRrJb365mgacti27VbfK2uOjIRD2',
    update_fields={
        'email': 'emanuele.sanzi@icloud.com',
        'autorizzato': True,
        'anteprima': False,
    }
)

# 2. Daniele (Bella Mbriana)
migra_utente(
    nome='Daniele',
    comunita_id='bella-mbriana',
    nuovo_uid='3LRx2cl7Tofe5oj0di9T5iQ5Td83',
    update_fields={
        'email': 'bho406096@gmail.com',
        'autorizzato': True,
        'anteprima': False,
    }
)

print('Fatto.')
