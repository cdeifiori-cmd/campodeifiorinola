import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

# 1. Aggiungi Rosina Franzese
ref = db.collection('staff').document()
ref.set({
    'nome': 'Rosina Franzese',
    'email': 'rosinafranzese6@gmail.com',
    'ruolo': 'educatrice',
    'comunita': 'Fortapasc',
    'comunitaId': 'fortapasc',
    'fotoProfilo': 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780216731/rosina_franzese_fwwpaf.png',
    'admin': False,
    'autorizzato': True,
    'anteprima': False,
})
print(f'OK: Rosina Franzese aggiunta (ID: {ref.id})')

# 2. Aggiorna campo "comunita" per gli altri staff
aggiornamenti = {
    'mEhzMoyQ9z3raU53nBvZ': 'Bella Mbriana',    # Federica
    'ItvxJbKjcPe7wjJPPvMq': 'Willy Coyote',      # Gina Graziano
    '0u41pvwSTAaryAGWAG8gwuxrZ293': '',           # Massimo Allocca
    'DpGXVE397tNCnNvgIqljPmOvJ4Y2': '',           # Maria Albano
    'XZGdhGkIv5NuRvAFNN7PS3P8Kgp2': '',           # Annalisa Nunziata
    'mCSgNMVEphVIIf4HX0bkcKq2ZKv2': '',           # Giacomo
}

for uid, comunita in aggiornamenti.items():
    db.collection('staff').document(uid).update({'comunita': comunita})
    print(f'OK: staff/{uid} comunita="{comunita}"')

print('Tutte le operazioni completate.')
