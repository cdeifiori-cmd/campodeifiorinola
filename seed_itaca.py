import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

ragazzi = [
    {'nome': 'Anna',      'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780161150/anna_itaca_dzb4gg.png'},
    {'nome': 'Francesca', 'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780161149/francesca_itaca_twb20p.png'},
    {'nome': 'Alessia',   'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780161148/alessia_itaca_s0e8li.png'},
    {'nome': 'Filippo',   'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780161146/filippo_itaca_yqprkx.png'},
    {'nome': 'Salvatore', 'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780161145/salvatore_itaca_q3x3av.png'},
]

for r in ragazzi:
    ref = db.collection('utenti').document()
    ref.set({
        'nome': r['nome'],
        'email': '',
        'comunitaId': 'itaca',
        'fotoProfilo': r['fotoProfilo'],
        'audioUrl': '',
        'miPresento': '',
        'autorizzato': False,
        'admin': False,
        'anteprima': True,
    })
    print(f'OK: {r["nome"]} aggiunto (ID: {ref.id})')

print('Tutti e 5 i ragazzi di Itaca aggiunti.')
