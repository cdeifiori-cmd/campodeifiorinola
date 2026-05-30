import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

db.collection('comunita').document('after-us').update({
    'nomeComunita': 'Follow Up'
})
print('OK: After Us rinominata in Follow Up')
