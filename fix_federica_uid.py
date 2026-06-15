import sys
sys.stdout.reconfigure(encoding='utf-8')

import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

UID_FEDERICA  = '6gOsxhM4RoXJkKMnK2YUn2uVR8A3'
NOME_CORRETTO = 'Federica Galano'

tutti = db.collection('piazzetta_posts').get()
post_aggiornati = 0
commenti_aggiornati = 0

for p in tutti:
    d = p.to_dict()
    if d.get('authorId') == UID_FEDERICA:
        nome_attuale = d.get('authorName', '')
        if nome_attuale != NOME_CORRETTO:
            db.collection('piazzetta_posts').document(p.id).update({'authorName': NOME_CORRETTO})
            print(f'Post {p.id}: "{nome_attuale}" -> "{NOME_CORRETTO}"')
            post_aggiornati += 1

    commenti = db.collection('piazzetta_posts').document(p.id).collection('comments').get()
    for c in commenti:
        cd = c.to_dict()
        if cd.get('authorId') == UID_FEDERICA:
            nome_attuale = cd.get('authorName', '')
            if nome_attuale != NOME_CORRETTO:
                db.collection('piazzetta_posts').document(p.id).collection('comments').document(c.id).update({'authorName': NOME_CORRETTO})
                print(f'Commento {c.id} in post {p.id}: "{nome_attuale}" -> "{NOME_CORRETTO}"')
                commenti_aggiornati += 1

print(f'\nPost aggiornati: {post_aggiornati}')
print(f'Commenti aggiornati: {commenti_aggiornati}')
print('Fatto.')
