import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

aggiornamenti = [
    # (uid, campi_da_aggiornare)
    ('XZGdhGkIv5NuRvAFNN7PS3P8Kgp2', {'ruolo': 'Coordinatrice Comunità Bella Mbriana'}),            # Annalisa Nunziata
    ('l7PpacmukqQSHRYhXxoP8zpWNnP2', {'ruolo': 'Educatore Bella Mbriana'}),                          # Enzo Liberti
    ('NCrbHMc7kvV4xsXQSoxrxTTtLUJ2', {'ruolo': 'Coordinatrice Comunità Itaca'}),                     # Fabiana Cimmino
    ('yp39YnGnUthal3jVUEvIeOktFbH3', {'ruolo': 'Educatore di Itaca'}),                               # Giovanni La Manna
    ('QTi0Jw6zxTX7fnRyZUVgEFmxIr02', {'ruolo': 'Educatrice di Bella Mbriana'}),                      # Giulia Nappo
    ('DpGXVE397tNCnNvgIqljPmOvJ4Y2', {'ruolo': 'Coordinatrice di Fortapasc e Macramè'}),             # Maria Albano
    ('urQW2rTUPmb1wWj72hm24UoXQDq2', {'ruolo': 'Educatrice di Itaca'}),                              # Marianna La Manna
    ('E9Ujxzk8N0Vh87ZQgK1QT9NOTxv2', {'nome': 'Olimpia Iossa', 'ruolo': 'Educatrice di Bella Mbriana'}),  # Olimpia Iossa
    ('mEhzMoyQ9z3raU53nBvZ',         {'nome': 'Federica Galano'}),                                   # Federica Galano
    ('mCSgNMVEphVIIf4HX0bkcKq2ZKv2', {'nome': 'Giacomo De Sena'}),                                   # Giacomo De Sena
]

for uid, fields in aggiornamenti:
    db.collection('staff').document(uid).update(fields)
    nome = fields.get('nome', uid)
    print(f'OK: {uid} - {fields}')

print('\nDone.')
