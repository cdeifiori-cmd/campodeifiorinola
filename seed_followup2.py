import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

ragazzi = [
    {'nome': 'Claudio Pannella',  'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780160935/cla_pan_lzvk4n.png'},
    {'nome': 'Alessandro Miele',  'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780160935/ale_ok_icxwst.png'},
]

for r in ragazzi:
    ref = db.collection('utenti').document()
    ref.set({
        'nome': r['nome'],
        'email': '',
        'comunitaId': 'after-us',
        'fotoProfilo': r['fotoProfilo'],
        'audioUrl': '',
        'miPresento': '',
        'autorizzato': False,
        'admin': False,
        'anteprima': True,
    })
    print(f'OK: {r["nome"]} aggiunto (ID: {ref.id})')

print('Fatto.')
