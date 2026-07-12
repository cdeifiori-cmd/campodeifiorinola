import sys
sys.stdout.reconfigure(encoding='utf-8')

import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(r'C:\Users\Utente\campodeifiorinola\serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

ATT_ID = 'consiglio-isola'

# ── 1. Anagrafica robinson_naufraghi ────────────────────────────────────────────────
naufraghi = {}  # docId -> {nome, campi extra}
for d in db.collection('robinson_naufraghi').stream():
    data = d.to_dict()
    naufraghi[d.id] = data

print(f'═══ robinson_naufraghi: {len(naufraghi)} documenti ═══')
for docId, data in naufraghi.items():
    extra = {k: v for k, v in data.items() if k not in ('nome',)}
    print(f'  docId={docId}  nome="{data.get("nome","")}"  altri campi={list(extra.keys())}')
print()

# ── 2. Rilevazioni + risposte (stesso path letto/scritto dal codice: attivita/.../risposte) ──
rilevazioni = list(db.collection('attivita', ATT_ID, 'rilevazioni').order_by('numero').stream())
print(f'═══ RILEVAZIONI: {len(rilevazioni)} ═══')
for r in rilevazioni:
    rd = r.to_dict()
    print(f'  id={r.id} numero={rd.get("numero")} stato={rd.get("stato")}')
print()

if not rilevazioni:
    sys.exit(0)

ril = rilevazioni[-1]
print(f'>>> Uso rilevazione id={ril.id} numero={ril.to_dict().get("numero")} <<<\n')

risposte_snap = list(db.collection('attivita', ATT_ID, 'rilevazioni', ril.id, 'risposte').stream())
risposte_docids = set(d.id for d in risposte_snap)
print(f'═══ RISPOSTE: {len(risposte_snap)} documenti (id documento = userId usato dal codice, r.userId = d.id) ═══')
for d in risposte_snap:
    data = d.to_dict()
    in_naufraghi = d.id in naufraghi
    print(f'  docId(=userId)={d.id}  {"[OK: corrisponde a un naufrago]" if in_naufraghi else "[!!! ORFANO: nessun naufrago con questo docId]"}')
print()

# ── 3. Match "ha risposto / non ha risposto": ESATTAMENTE la logica del codice ──────
# js: const rispondentiSet = new Set(risposte.map(r => r.userId));  // r.userId = doc.id
#     const nonRispondente = !rispondentiSet.has(uid);              // uid = robinson_naufraghi docId
print('═══ MATCH "ha risposto / non ha risposto" (stessa logica del codice) ═══')
non_rispondenti = []
for docId, data in naufraghi.items():
    ha_risposto = docId in risposte_docids
    if not ha_risposto:
        non_rispondenti.append((docId, data.get('nome', '')))
    print(f'  {data.get("nome",""):20s} naufraghi.docId={docId}  ha_risposto={ha_risposto}')
print()

# ── 4. Orfani: risposte il cui docId non corrisponde a NESSUN naufrago ──────────────
orfani = [d for d in risposte_snap if d.id not in naufraghi]
print(f'═══ RISPOSTE ORFANE (docId non presente in robinson_naufraghi): {len(orfani)} ═══')
for d in orfani:
    print(f'  docId={d.id}')
print()

# ── 5. Per ogni "non rispondente", cerchiamo un possibile ID alternativo via utenti/staff ──
print('═══ RICERCA ID ALTERNATIVI per i "non rispondenti" (collezione utenti / staff) ═══')
for docId, nome in non_rispondenti:
    print(f'--- {nome} (robinson_naufraghi docId={docId}) ---')
    # a) leggiamo il documento naufrago per eventuali campi uid/authUid/email
    ndata = naufraghi[docId]
    for campo in ('authUid', 'uid', 'email', 'emailNaufrago', 'emailUtente'):
        if campo in ndata:
            print(f'    campo "{campo}" nel doc naufrago = {ndata[campo]}')
    # b) cerchiamo in utenti per nome uguale
    try:
        q = db.collection('utenti').where('nome', '==', nome).get()
        for u in q:
            ud = u.to_dict()
            marcatore = ' <-- QUESTO risponde nella rilevazione!' if u.id in risposte_docids else ''
            print(f'    [utenti] docId={u.id} nome="{ud.get("nome","")}" email="{ud.get("email","")}"{marcatore}')
    except Exception as e:
        print(f'    (errore query utenti: {e})')
    print()

print('═══ RIEPILOGO ═══')
print(f'Naufraghi totali: {len(naufraghi)}')
print(f'Non rispondenti secondo il match attuale: {len(non_rispondenti)} -> {[n for _,n in non_rispondenti]}')
print(f'Risposte orfane (nessun naufrago con quel docId): {len(orfani)}')
