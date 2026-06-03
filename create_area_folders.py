"""
create_area_folders.py
Crea i placeholder .keep nelle 10 cartelle area su Firebase Storage
per ogni utente nella collezione 'utenti' con comunitaId valido (no after-us).

Usa firebase-admin con Storage.
Esecuzione: python create_area_folders.py
"""
import firebase_admin
from firebase_admin import credentials, firestore, storage as fb_storage

SA_PATH = r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json'
BUCKET  = 'campo-dei-fiori.firebasestorage.app'

AREE = [
    'Anagrafica e Giuridica',
    'Sanitaria',
    'Familiare',
    'Scolastica-Formativa',
    'Educativa',
    'Psicologica',
    'Relazioni e Comunicazioni Istituzionali',
    'Amministrativa',
    'Autonomia e Progetto di Vita',
    'Varie ed Eventuali',
]

VALID_COMUNITA = {'bella-mbriana', 'fortapasc', 'itaca', 'macrame', 'willy-coyote'}

cred = credentials.Certificate(SA_PATH)
firebase_admin.initialize_app(cred, {'storageBucket': BUCKET})

db     = firestore.client()
bucket = fb_storage.bucket()

print('Lettura utenti da Firestore...')
docs = list(db.collection('utenti').stream())
valid = [(d.id, d.to_dict()) for d in docs if d.to_dict().get('comunitaId') in VALID_COMUNITA]
print(f'Utenti validi trovati: {len(valid)}')

created  = 0
skipped  = 0
errors   = 0

for uid, data in valid:
    nome       = data.get('nome', uid)
    comunita   = data.get('comunitaId')
    for area in AREE:
        path = f'documenti/{comunita}/{uid}/{area}/.keep'
        blob = bucket.blob(path)
        try:
            if blob.exists():
                skipped += 1
            else:
                blob.upload_from_string(b'', content_type='application/octet-stream')
                print(f'  OK: {nome} / {area}')
                created += 1
        except Exception as e:
            print(f'  ERRORE {nome} / {area}: {e}')
            errors += 1

print(f'\n--- Riepilogo ---')
print(f'Creati:  {created}')
print(f'Esistenti (skip): {skipped}')
print(f'Errori:  {errors}')
print('Done.')
