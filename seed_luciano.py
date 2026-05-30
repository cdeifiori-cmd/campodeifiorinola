import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

uid = 'B4hC5v0TiuZ6V6uItc4AuNWaT2B3'

db.collection('utenti').document(uid).set({
    'nome': 'Luciano',
    'email': 'lfiorucci4@gmail.com',
    'comunitaId': 'macrame',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780152211/luciano_loxngu.png',
    'audioUrl': 'https://dn720703.ca.archive.org/0/items/audio-luciano/audio%20luciano.mp3',
    'miPresento': 'Ciao ragazzi belli allora, alcuni miei hobby sono fare le lavatrici stendere i panni pulire la casa. I miei progetti futuri in un futuro abbastanza lontano sogno di aprire un hotel invece un qualcosa di immediato e di dedicarmi al lavoro e iniziare a costruire qualcosa. Mi piacciano tanti gli animali ed essere sempre presentabile pulito e sistemato cose che non mi piacciono e vedere tipo la casa sottosopra ecc.... Di tempo libero poco ne ho però quando lo trovo cerco di passarlo con gli amici e mi dedico molto al mio benessere. Le cose che mi piacciono di me sono una persona molto sincera ed anche troppo alcune volte. La cosa che non mi piace di me e che soni molto insistente e impulsivo.',
    'autorizzato': True,
    'admin': False,
})
print('OK: Luciano aggiunto a Firestore (macrame)')
