import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

ref = db.collection('utenti').document()
ref.set({
    'nome': 'Veronica Bellopede',
    'email': '',
    'comunitaId': 'after-us',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780160993/veronica_ok_k8qap0.png',
    'audioUrl': 'https://ia601002.us.archive.org/8/items/audio-veronica/audio%20veronica.mp3',
    'miPresento': "Ciao mi chiamo Veronica Bellopede ho' 20 anni vivo centro storico di Napoli forcella. Sono una ragazza dolce sensibile testa dura. Nel tempo libero mi piace fare tik tok e fare disegni poi il mio punto di forza sono i ricordi belli. In me devo migliorare a non fare dí testa mia sempre e devo essere più calma e meno nervosa. Il mio obbietto è raggiogiere la persona che voglio diventare un giorno. Il mio abit è Nola campo dei fiori.",
    'autorizzato': False,
    'admin': False,
    'anteprima': True,
})
print(f'OK: Veronica Bellopede aggiunta a Firestore (after-us)')
print(f'ID documento: {ref.id}')
