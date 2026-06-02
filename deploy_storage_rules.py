"""
Deploya le Firebase Storage security rules tramite Firebase Rules REST API.
"""
import json, sys
from pathlib import Path

try:
    import google.oauth2.service_account as sa_module
    import google.auth.transport.requests as ga_requests
    import requests
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "google-auth", "requests", "-q"])
    import google.oauth2.service_account as sa_module
    import google.auth.transport.requests as ga_requests
    import requests

SA_PATH    = r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json'
RULES_PATH = Path(__file__).parent / 'storage.rules'
PROJECT_ID = 'campo-dei-fiori'
SCOPES     = ['https://www.googleapis.com/auth/firebase']

credentials = sa_module.Credentials.from_service_account_file(SA_PATH, scopes=SCOPES)
credentials.refresh(ga_requests.Request())
token = credentials.token

rules_content = RULES_PATH.read_text(encoding='utf-8')
headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

# 1. Crea il nuovo ruleset
r = requests.post(
    f'https://firebaserules.googleapis.com/v1/projects/{PROJECT_ID}/rulesets',
    json={'source': {'files': [{'name': 'storage.rules', 'content': rules_content}]}},
    headers=headers
)
r.raise_for_status()
ruleset_name = r.json()['name']
print(f'Ruleset creato: {ruleset_name}')

# 2. Crea o aggiorna il release firebase.storage
release_name = f'projects/{PROJECT_ID}/releases/firebase.storage'
release_body = {'release': {'name': release_name, 'rulesetName': ruleset_name}}

# Prova prima PATCH (aggiorna esistente), poi POST (crea nuovo)
r2 = requests.patch(
    f'https://firebaserules.googleapis.com/v1/{release_name}',
    json=release_body, headers=headers
)
if r2.status_code == 404:
    r2 = requests.post(
        f'https://firebaserules.googleapis.com/v1/projects/{PROJECT_ID}/releases',
        json=release_body, headers=headers
    )
r2.raise_for_status()
print('Storage rules deployate con successo!')
print(json.dumps(r2.json(), indent=2))
