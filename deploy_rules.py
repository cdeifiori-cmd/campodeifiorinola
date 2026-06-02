"""
Deploya le Firestore security rules tramite Firebase Management REST API.
Richiede: pip install google-auth requests
"""
import json, sys
from pathlib import Path

try:
    import google.oauth2.service_account as sa_module
    import google.auth.transport.requests as ga_requests
    import requests
except ImportError:
    print("Installo dipendenze...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "google-auth", "requests", "-q"])
    import google.oauth2.service_account as sa_module
    import google.auth.transport.requests as ga_requests
    import requests

SA_PATH   = r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json'
RULES_PATH = Path(__file__).parent / 'firestore.rules'
PROJECT_ID = 'campo-dei-fiori'

SCOPES = ['https://www.googleapis.com/auth/firebase']

credentials = sa_module.Credentials.from_service_account_file(SA_PATH, scopes=SCOPES)
auth_req    = ga_requests.Request()
credentials.refresh(auth_req)
token = credentials.token

rules_content = RULES_PATH.read_text(encoding='utf-8')

url = f'https://firebaserules.googleapis.com/v1/projects/{PROJECT_ID}/rulesets'
payload = {
    'source': {
        'files': [{'name': 'firestore.rules', 'content': rules_content}]
    }
}
headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

# 1. Crea il nuovo ruleset
r = requests.post(url, json=payload, headers=headers)
r.raise_for_status()
ruleset_name = r.json()['name']
print(f'Ruleset creato: {ruleset_name}')

# 2. Aggiorna il release (cloud.firestore) per puntare al nuovo ruleset
release_url = f'https://firebaserules.googleapis.com/v1/projects/{PROJECT_ID}/releases/cloud.firestore'
release_payload = {'release': {'name': f'projects/{PROJECT_ID}/releases/cloud.firestore', 'rulesetName': ruleset_name}}
r2 = requests.patch(release_url, json=release_payload, headers=headers)
r2.raise_for_status()
print('Release aggiornato. Rules deployate con successo!')
print(json.dumps(r2.json(), indent=2))
