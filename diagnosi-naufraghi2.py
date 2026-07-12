import sys
sys.stdout.reconfigure(encoding='utf-8')

import firebase_admin
from firebase_admin import credentials, firestore, auth

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

ATT_ID = 'consiglio-isola'

naufraghi = {d.id: d.to_dict() for d in db.collection('robinson_naufraghi').stream()}

rilevazioni = list(db.collection('attivita', ATT_ID, 'rilevazioni').order_by('numero').stream())
ril = rilevazioni[-1]
risposte_snap = list(db.collection('attivita', ATT_ID, 'rilevazioni', ril.id, 'risposte').stream())
risposte_docids = set(d.id for d in risposte_snap)

print(f'Rilevazione usata: {ril.id} (numero={ril.to_dict().get("numero")})')
print(f'Risposte totali: {len(risposte_snap)}\n')

non_rispondenti = [(docId, data.get('nome', '')) for docId, data in naufraghi.items() if docId not in risposte_docids]

# Mappa TUTTI gli utenti Firebase Auth per email, per un lookup rapido
print('Carico elenco account Firebase Auth (potrebbe richiedere qualche secondo)...')
auth_by_email = {}
for u in auth.list_users().iterate_all():
    if u.email:
        auth_by_email[u.email.lower()] = u

print(f'Account Auth totali: {len(auth_by_email)}\n')

print('═══ TABELLA COMPLETA (a) uid Auth reale / (b) docId robinson_naufraghi / (c) risposta trovata ═══')
righe = []
for docId, nome in non_rispondenti:
    ndata = naufraghi[docId]
    campo_uid_interno = ndata.get('uid', '')

    # utenti collegati per nome (stesso approccio del report precedente)
    utenti_match = list(db.collection('utenti').where('nome', '==', nome).stream())

    # Per ciascun utenti-match, verifichiamo l'email e cerchiamo l'uid Auth REALE per quella email
    auth_uids_trovati = set()
    email_per_doc = {}
    for u in utenti_match:
        ud = u.to_dict()
        email = (ud.get('email') or '').lower()
        email_per_doc[u.id] = email
        if email and email in auth_by_email:
            auth_uids_trovati.add(auth_by_email[email].uid)

    # Proviamo anche l'email standard "nome.robinson@campodeifiori.org" nel caso non sia nei match utenti
    nome_slug = nome.lower().replace(' ', '.')
    email_standard = f'{nome_slug}.robinson@campodeifiori.org'
    if email_standard in auth_by_email:
        auth_uids_trovati.add(auth_by_email[email_standard].uid)

    # Cerchiamo una risposta per OGNI id plausibile: docId naufraghi, campo uid interno,
    # ogni docId utenti trovato, ogni uid Auth reale trovato
    candidati_id = set([docId, campo_uid_interno]) | set(u.id for u in utenti_match) | auth_uids_trovati
    candidati_id.discard('')
    risposta_trovata = None
    for cid in candidati_id:
        if cid in risposte_docids:
            risposta_trovata = cid
            break

    riga = {
        'nome': nome,
        'docId_naufraghi(b)': docId,
        'uid_interno_naufraghi': campo_uid_interno,
        'utenti_docIds': [u.id for u in utenti_match],
        'auth_uid_reale(a)': list(auth_uids_trovati) or None,
        'risposta_trovata_sotto(c)': risposta_trovata,
        'a_diverso_da_b': bool(auth_uids_trovati) and auth_uids_trovati != {docId},
    }
    righe.append(riga)
    print(f"- {nome}")
    print(f"    (b) docId robinson_naufraghi = {docId}")
    print(f"    campo uid interno            = {campo_uid_interno}")
    print(f"    utenti (docId: email)        = {[(u.id, email_per_doc[u.id]) for u in utenti_match]}")
    print(f"    (a) uid Auth REALE trovato   = {list(auth_uids_trovati) or 'NESSUNO TROVATO'}")
    print(f"    (a) != (b) ?                  = {riga['a_diverso_da_b']}")
    print(f"    (c) risposta trovata sotto id = {risposta_trovata or 'NESSUNA (in nessuno degli id candidati)'}")
    print()

print('═══ RIEPILOGO ═══')
divergenti = [r for r in righe if r['a_diverso_da_b']]
trovate = [r for r in righe if r['risposta_trovata_sotto(c)']]
print(f'Naufraghi con (a) uid Auth reale DIVERSO da (b) docId anagrafico: {len(divergenti)} -> {[r["nome"] for r in divergenti]}')
print(f'Naufraghi per cui e stata comunque trovata una risposta sotto QUALCHE id candidato: {len(trovate)} -> {[r["nome"] for r in trovate]}')
