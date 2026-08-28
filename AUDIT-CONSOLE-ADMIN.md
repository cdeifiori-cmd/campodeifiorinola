# AUDIT — Console Admin Centrale Campo dei Fiori

> Consegna FASE 0 → PRIMA CONSEGNA OBBLIGATORIA. **Nessuna implementazione.**
> Data audit: 2026-08-28 · Branch: `master` · HEAD: `bc4d421` · Repo: `github.com/cdeifiori-cmd/campodeifiorinola`

---

## FASE 0 — Sicurezza del lavoro (stato attuale)

| Voce | Stato |
|---|---|
| Repository | `campodeifiorinola` (locale `F:\progetto_app_campodeifiori`) |
| Branch corrente | `master` (main = `master`; esiste anche `origin/main`) |
| HEAD | `bc4d421 feat(ppu): add reflected-image assessment and align live PPU` |
| Modifiche NON committate | **Sì** — 12 file modificati (`firestore.rules`, `firestore.indexes.json`, `js/ppu-scheda-a.js`, `js/ppu-scheda-b.js`, `package.json`, `.gitignore`, 6 file `robinson/…`) + molti file untracked (script `seed_*`, `.csv`, screenshot) |
| Stash | vuoto |
| Deploy | **non eseguito**, non eseguirò deploy |
| Modifiche a dati/utenti reali | **nessuna** — audit di sola lettura |

**Raccomandazione operativa:** prima di iniziare qualunque implementazione, chiudere le modifiche pendenti (commit o stash). Le modifiche pendenti a `firestore.rules` e ai file `robinson/` sono estranee alla Console Admin e non vanno mescolate. Per l'intervento Console Admin consiglio un branch dedicato `feat/console-admin`.

> ⚠️ In repo è presente il file `.firebase-service-account.json` (2,4 KB) nella working dir. È in `.gitignore` (non tracciato), ma è una chiave con privilegi Admin che non deve stare nella cartella di progetto. Diversi script locali (`seed_*.py`, `*.cjs`) usano una service account (`C:\Users\Utente\campodeifiorinola\serviceAccountKey.json`, fuori repo). Nessuno di questi script fa parte dell'app servita.

---

## 1. ARCHITETTURA ATTUALE

### 1.1 Stack

- **Front-end statico** puro (HTML + JS ES-module, no build) servito da **Netlify** (`CNAME` → dominio) e configurato anche per **Firebase Hosting** (`firebase.json` `hosting.public: "."`).
- **Firebase project unico**: `campo-dei-fiori`.
  - Web-app config **principale** (`js/firebase-config.js`, e ripetuta inline in quasi ogni HTML): `appId 1:928976798756:web:…`, bucket `campo-dei-fiori.firebasestorage.app`.
  - Web-app config **Robinson** (`robinson/js/robinson-firebase.js`): `appId 1:325163062652:web:…`, bucket `campo-dei-fiori.appspot.com`. **Stesso projectId, stesso pool Auth, stesso Firestore** — cambia solo la registrazione web-app e il bucket citato.
- **Firestore** (region europe-west1) — database principale.
- **Firebase Storage** — usato **solo** per `documenti/**` (fascicoli). Foto/audio passano tutti da **Cloudinary** (`cloud_name dxqyprtzh`, preset unsigned `campo_dei_fiori`).
- **Cloud Functions** (`functions/`, nodejs22): 6 trigger notifiche push FCM + 1 callable `loginRagazzoConPin` (**attualmente non usata dal client** — vedi §4).

### 1.2 Catena identità → autorizzazione (com'è OGGI)

```
Firebase Authentication (email/password)
        │  cred.user.uid
        ▼
UID  ─── è il DOCUMENT ID di:
        ├── staff/{uid}      → operatori/educatori (login email reale)
        ├── utenti/{uid}     → ragazzi/minori + After Us (login via PIN → account Auth sintetico)
        └── amici/{uid}      → "amici" della comunità (login email)
        ▼
Appartenenza:
        utenti/{uid}.comunitaId  = 'bella-mbriana'|'itaca'|'willy-coyote'|'fortapasc'|'macrame'|'after-us'  (STRINGA singola)
        staff/{uid}.comunitaId   = stringa OPPURE array (coordinatori multi-comunità)  ← non sempre presente
        ▼
Ruolo:
        staff/{uid}.ruolo   = STRINGA LIBERA ("Coordinatrice Comunità Itaca", "Educatore Bella Mbriana", "educatore", …)
        staff/{uid}.admin   = boolean (informativo, quasi sempre false)
        NESSUN custom claim Firebase in uso da nessuna parte.
        ▼
Admin:
        Hardcoded UID  'mCSgNMVEphVIIf4HX0bkcKq2ZKv2'  (Giacomo De Sena)
        ripetuto in: firestore.rules, storage.rules, functions, nav-docs.js,
        documenti.html, gestione-ragazzi.html, afterus.html, ragazzi.html,
        staff.html, robinson/js/robinson-firebase.js  (10+ punti)
        ▼
Permessi applicativi:
        - Documenti:  staff.ruolo contiene "coordinat"/"responsabil"  OPPURE  staff.accessoDocumenti === true  (scoping per comunità)
        - PPU schede: stessa regola di Documenti, riscritta in firestore.rules
        - "amici"/"utenti" NON hanno accesso Documenti dal data-layer (solo staff)
```

### 1.3 `onAuthStateChanged` — pattern ricorrente

Ogni pagina fa: `onAuthStateChanged` → se `user`, `getDoc('utenti'/{uid})` poi fallback `getDoc('staff'/{uid})` (a volte anche `amici`). Non esiste un modulo unico di "sessione/identità": la logica è **duplicata** in `js/auth.js`, `js/nav-auth.js`, `js/nav-docs.js` e inline in ~15 HTML.

---

## 2. COLLEZIONI FIRESTORE (rilevanti per la Console)

| Collezione | Doc ID | Funzione | Campi principali | Relazioni | UID? | comunitaId? |
|---|---|---|---|---|---|---|
| `utenti` | Auth UID | **Ragazzi/minori + After Us** (e alcuni staff Robinson) | `nome`, `comunitaId` (stringa), `fotoProfilo` (URL Cloudinary), `email` (sintetica o vuota), `stato` (`attivo`/`archiviato`), `admin` (bool), `miPresento`, `audioUrl`, `numeroAccessi`, `interazioni.*`, `primoAccesso`, `anteprima`, a volte `ruolo` (per naufraghi/ciurma Robinson), `fotoPosition` | `comunitaId` → `comunita/{id}`; UID → `diario`, `messaggiBottiglia`, Storage `documenti/{com}/{uid}/…`, `ppu_schede_*` (`minorId`) | ✅ = doc id | ✅ stringa |
| `staff` | Auth UID | **Operatori/educatori** (login email) | `nome`, `email`, `ruolo` (stringa libera), `admin` (bool), `comunitaId` (stringa **o array**, non sempre presente), `comunita` (label testuale, a volte), `accessoDocumenti` (bool, opzionale), `fotoProfilo`, `autorizzato`, `numeroAccessi`, `interazioni.*`, `fcmToken(s)` | `comunitaId` → `comunita`; UID → Storage rules, PPU rules | ✅ = doc id | ⚠️ stringa **o** array, spesso assente |
| `amici` | Auth UID | "Amici" della comunità | `nome`, `fotoProfilo`, `email`, `fcmToken(s)` | — | ✅ | ❌ |
| `comunita` | slug (`itaca`, `after-us`, …) | Anagrafica comunità | `nomeComunita`, `descrizione`, `immagineUrl`, `ordine` (int) | referenziata da `utenti.comunitaId`, `staff.comunitaId` | — | è la chiave |
| `utenti_pin` | Auth UID (ragazzo) | PIN **in chiaro** + metadati login | `uid`, `nome`, `pin` (chiaro), `email` (sintetica), `comunitaId`, `createdAt`, `lastLogin` | UID ↔ `utenti` | ✅ | ✅ |
| `utenti_pin_lookup` | il PIN stesso | Lookup pubblico PIN→account per login | `{ uid, email }` (NO password) | PIN → `utenti/{uid}` | ✅ | ❌ |
| `pin_login_rate` | hash SHA-256 IP | Rate-limit login PIN (usato solo da Cloud Function, oggi non attiva) | `count`, `windowStart`, `lockedUntil`, `lastAttemptAt` | — | ❌ | ❌ |
| `ppu_schede_a` | auto-id | PPU "Come mi vedo" (autovalutazione) | `minorId` (=UID ragazzo), `comunitaId`, `createdBy` (UID staff), `conductedBy`, `createdAt`, `assessmentDate`, `momento`, `stato` (bozza/…), `updatedAt`, dati indicatori | `minorId` → `utenti`; `comunitaId` → `comunita`; `createdBy` → `staff` | ✅ (`minorId`,`createdBy`) | ✅ **immutabile dopo creazione** |
| `ppu_schede_b` | auto-id | PPU "Come penso che mi vedano gli altri" | idem Scheda A | idem | ✅ | ✅ **immutabile** |
| `diario` | auto-id | Post diario del ragazzo | `uidRagazzo`, `testo`, `immagineUrl`, `createdAt`, `isWelcome`, `reazioni` | `uidRagazzo` → `utenti` | ✅ | ❌ (nessun comunitaId storicizzato) |
| `messaggiBottiglia` | auto-id | Messaggi tra utenti | `uidMittente`, `uidDestinatario`, `nomeMittente`, `testo`, `createdAt` | UID → `utenti`/`staff` | ✅ | ❌ |
| `piazzetta_posts` | auto-id | Bacheca comune | `authorId`, `authorName`, `text`, `media`, `timestamp`, `reactions`, `commentsCount` | `authorId` → utenti/staff | ✅ | ❌ |
| `notifiche` | Auth UID | Contatore notifiche non lette + `ultimaLettura` | `contatore`, `ultimaLettura` | UID | ✅ | ❌ |
| `robinson_*` (≈20 collezioni) | UID / slug | Sotto-app Robinson (naufraghi, ciurma, isola, diari, PIN separati, magazzino, ecc.) | vari | `robinson_pin_lookup` salva **anche la password in chiaro** | ✅ | ❌ |
| `magazzino_autorizzati` | UID | Whitelist accesso "Gestione" Robinson | — | — | ✅ | ❌ |
| `attivita` / `attivita/*/rilevazioni/*/risposte` | auto-id | Hub attività + Consiglio dell'Isola | `stato`, risposte per userId | UID | ✅ | ❌ |

**Storage** (bucket `campo-dei-fiori.firebasestorage.app`):
```
documenti/documenti-generali/{file}                               ← Segreteria (non legata a comunità)
documenti/{comunitaId}/{uid}/{area}/{...sottocartelle}/{file}     ← fascicolo personale per comunità
   area ∈ {Anagrafica e Giuridica, Sanitaria, Familiare, Scolastica-Formativa,
           Educativa (=PPU), Psicologica, Relazioni e Comunicazioni Istituzionali,
           Amministrativa, Autonomia e Progetto di Vita, Varie ed Eventuali}
```
`comunitaId` nel path è **quello di creazione della cartella** (script `create_area_folders.py` genera `.keep` per ogni `utenti` con `comunitaId ∈ VALID_COMUNITA`, escluso `after-us`).

---

## 3. MODELLO UTENTI (tipi di persona e come sono identificati)

| Tipo | Dove vive | Come accede | Identificato da | Note |
|---|---|---|---|---|
| **Admin** | `staff/mCSg…` (+ è anche in `utenti`? no) | email/password | **UID hardcoded** | Un solo admin. Nessun meccanismo per aggiungerne altri se non modificando codice + regole. |
| **Operatore / Educatore / Coordinatore** | `staff/{uid}` | email/password (`signInWithEmailAndPassword`) | UID; ruolo = **stringa libera** | Coordinatore/Responsabile riconosciuto per **substring** `coordinat`/`responsabil` in `ruolo` (case-insensitive). `comunitaId` stringa o array, **spesso assente**. |
| **Ragazzo / Minore** | `utenti/{uid}` con `comunitaId ≠ after-us` | **PIN** → account Auth **sintetico** (email `nome.ragazzo@campodeifiori.org`, password `"CF"+pin`) → `signInWithEmailAndPassword` client-side | UID; `comunitaId` stringa | Vedi §8. `stato` `attivo`/`archiviato`. Nome→email: **rischio collisione** se due ragazzi hanno lo stesso nome. |
| **After Us** | `utenti/{uid}` con `comunitaId === 'after-us'` | come i ragazzi (se hanno PIN) oppure nessun login | UID; `comunitaId = 'after-us'` | **Non è un tipo separato**: è solo un valore di `comunitaId`. `comunita/after-us` esiste (label mutata in "Follow Up" da `update_afterus.py`). |
| **Amico** | `amici/{uid}` | email/password | UID | Nessun `comunitaId`, nessun accesso Documenti dal data-layer. |
| **Naufrago / Ciurma (Robinson)** | `utenti/{uid}` con `ruolo` = `naufrago`/`ciurma` **+** `robinson_naufraghi/{uid}` o `robinson_ciurma/{uid}` | PIN Robinson separato (email `*.robinson@campodeifiori.org`, password `"RR"+pin`) | UID (spesso **nuovo** UID con `originalUid` che punta al vecchio) | Sistema PIN **distinto** da quello dei ragazzi del sito principale. |

**Punto chiave identità:** oggi `personId` **coincide con l'Auth UID** ed è già stabile per i ragazzi finché non si ricrea l'account. Spostare un ragazzo di comunità = `updateDoc(utenti/{uid}, { comunitaId })`. Nessuna necessità di duplicare/ricreare.

---

## 4. CREAZIONE UTENTI (com'è OGGI)

### 4.1 Operatore/Staff
**Solo via script locale** con Firebase Admin SDK (`seed_*.py`, `seed_batch_giugno2026.py`): `auth.create_user(uid=…, email, password)` + `db.collection('staff').document(uid).set({nome, email, ruolo, admin, …})`. **Nessuna UI** per creare staff. Ruoli assegnati da `update_ruoli_staff.py`.

### 4.2 Ragazzo (UI esistente: `gestione-ragazzi.html` + `js/ragazzi-pin.js`)
Flusso **interamente client-side** (commit `a6f811c` "Torna al login PIN ragazzi client-side, modello Robinson"):
1. `generaPin()` → PIN 6 cifre (login accetta 4–6).
2. `nomeToEmail(nome)` → `marco.rossi.ragazzo@campodeifiori.org`.
3. `fetch identitytoolkit.googleapis.com/v1/accounts:signUp?key=API_KEY` (REST diretta con la Web API key) → nuovo account Auth, ottiene `localId`. *(La REST non tocca lo stato dell'SDK, quindi l'admin resta loggato.)*
4. Foto (opzionale) → upload **Cloudinary** unsigned → URL.
5. `setDoc(utenti/{uid}, { nome, comunitaId, fotoProfilo, email, admin:false, stato:'attivo', createdAt })`.
6. `setDoc(utenti_pin/{uid}, { uid, nome, pin, email, comunitaId, createdAt, lastLogin:null })` — **PIN in chiaro**.
7. `setDoc(utenti_pin_lookup/{pin}, { uid, email })`.

**Cambio PIN** (`cambiaPinRagazzo`): REST `signInWithPassword` con vecchia password → REST `accounts:update` con nuova password → aggiorna `utenti_pin` + `utenti_pin_lookup`. *(Unico modo di cambiare password Auth senza Admin SDK.)*

**Cambio foto** (`cambiaFotoRagazzo`): Cloudinary → `updateDoc(utenti/{uid}, { fotoProfilo })`.

**Archiviazione** (`setStatoRagazzo`): `updateDoc(utenti/{uid}, { stato:'archiviato'|'attivo' })`. **Nessuna cancellazione** di account o dati.

### 4.3 Cloud Function `loginRagazzoConPin` — **presente ma NON usata**
`functions/pinLogin.js` implementa il login PIN lato server (Admin SDK, rate-limit per IP, custom token, mai email/password). `functions/index.js` la esporta. **Ma** `login.html` importa `loginConPin` da `js/ragazzi-pin.js` (client-side), non la function. Codice morto / percorso alternativo abbandonato (commit `8e67581` poi revert `a6f811c`).

---

## 5. DOCUMENTI — come è protetta oggi e cosa manca

### 5.1 Chi può aprire `documenti.html` (client)
`onAuthStateChanged` in `documenti.html` (righe ~801-836):
1. non loggato → `showAccessDenied()`.
2. `user.uid === ADMIN_UID` → `isAdmin = true` → accesso totale.
3. altrimenti loop `['utenti','staff','amici']`:
   - se **`staff`** e `ruolo` contiene `coordinat`/`responsabil` → `isCoord=true` + `myComunita` = `comunitaId` (normalizzato ad array);
   - se **`data.accessoDocumenti === true`** su **qualunque** delle 3 collezioni → `isCoord=true`.
4. `canWrite = isAdmin || isCoord`; se `!canWrite` → `showAccessDenied()`.

Poi `showCommunities()` filtra su `VALID_COMUNITA = ['bella-mbriana','fortapasc','itaca','macrame','willy-coyote']` **∩** (`isAdmin` || `myComunita.includes(id)`). **`after-us` non è tra le comunità mostrate**, nemmeno all'admin.

### 5.2 Cosa fa rispettare davvero il data-layer

**`storage.rules`** (robusto, allineato al client, corretto di recente):
- `documenti/documenti-generali/**`: read/create/update se super-user (admin **o** `0u41pvwSTAaryAGWAG8gwuxrZ293` = "Massimo") **o** coordinatore/responsabile (qualsiasi comunità) **o** staff con `accessoDocumenti`. **delete solo super-user.**
- `documenti/{comunitaId}/**`: idem ma **scoping per comunità** (`staff.comunitaId` stringa o array deve includere `comunitaId`). `accessoDocumenti` valido **solo se sul doc `staff`** (mai `utenti`/`amici`).
- catch-all `{prefix}/{allPaths=**}`: `read,write if prefix != 'documenti' && auth != null` — l'esclusione esplicita di `documenti` impedisce che il catch-all riapra l'accesso.

**`firestore.rules`** per `ppu_schede_a` / `ppu_schede_b` (le schede di autovalutazione vivono in **Firestore**, non Storage): `canAccessPPU(comunitaId)` = `isAdmin()` || coordinatore/responsabile **con `staff` doc e comunità corrispondente** || staff con `accessoDocumenti` e comunità corrispondente. `comunitaId/minorId/createdBy/createdAt` **immutabili** dopo la creazione. `delete` solo admin. → **Un ragazzo (doc `utenti`, nessun doc `staff`) non può mai leggere una scheda PPU.** Regola solida.

### 5.3 Vulnerabilità / logiche incomplete rilevate dal codice

| # | Descrizione | Impatto reale |
|---|---|---|
| D1 | **`documenti.html` accetta `accessoDocumenti === true` anche su `utenti`/`amici`** (§5.1 punto 3), mentre `storage.rules` lo onora **solo su `staff`**. E `firestore.rules` consente a **`isOwner(uid)` di aggiornare qualsiasi campo del proprio `utenti/{uid}`** (riga 21). ⇒ un ragazzo loggato via PIN può fare `updateDoc(utenti/{suoUid}, { accessoDocumenti:true })` e **ottenere l'intera UI di Area Documenti** (navigazione comunità, elenco ragazzi, viste cartelle). I **download dei file** falliscono (Storage nega), ma **nomi file, struttura cartelle, elenco nominativo dei ragazzi per comunità e le liste PPU** diventano visibili. UI-only gate ⇒ **bypassabile**. |
| D2 | **`after-us` invisibile in Area Documenti**: `showCommunities()` e `showRagazzi()` iterano solo `VALID_COMUNITA` (5 comunità). Quando un ragazzo passa ad After Us, il suo fascicolo storico resta in Storage sotto `documenti/{vecchiaComunita}/{uid}/…` ma **non è più raggiungibile** dalla UI (né per admin né per nessuno). Nessuna cartella `documenti/after-us/…` prevista. |
| D3 | **PPU legato alla comunità di creazione (immutabile)**: dopo un trasferimento, le schede `ppu_schede_*` con `comunitaId = vecchiaComunità` **non sono più leggibili** dal coordinatore della **nuova** comunità (solo admin o staff della vecchia). Questo è coerente col principio "la scheda è un evento avvenuto in quella comunità", ma **oggi non c'è nessuna vista che ricomponga lo storico PPU cross-comunità** per chi segue il ragazzo adesso. |
| D4 | **Nessun `comunitaId` storicizzato su `diario`/`messaggiBottiglia`/`piazzetta_posts`**: non c'è rischio di "riscrittura di massa" perché quei dati non hanno il campo; ma non c'è nemmeno modo di sapere in quale comunità è avvenuto un evento del diario. |
| D5 | **`amici` con `accessoDocumenti`**: `nav-docs.js` (riga 39-45) mostra il link Documenti anche per `amici` con `accessoDocumenti:true`. Storage nega comunque. Incoerenza client/data-layer (bassa gravità). |
| D6 | **Nessun audit trail**: nessuna traccia di chi ha caricato/eliminato un file, chi ha cambiato un permesso, chi ha trasferito un ragazzo. |
| D7 | **`delete` file Documenti**: `storage.rules` lo concede a super-user (admin **o Massimo**). Il secondo UID hardcoded (`isMassimo`) è una concessione permanente non gestibile da UI. |

**Requisito minimo richiesto dal brief (`accessoDocumenti = sì/no`) — valutazione:**
Oggi il flag `accessoDocumenti` **esiste già** come booleano su `staff`, ed è **già rispettato da `storage.rules` e `firestore.rules`** (scoping per comunità). Quindi il requisito minimo è **quasi soddisfatto a livello dati**. Quello che manca è: (a) una UI per settarlo/revocarlo; (b) chiudere il buco D1 (client deve leggere il flag **solo da `staff`**, e le regole `utenti` non devono lasciare `isOwner` scrivere campi di sistema); (c) decidere il default per gli staff che il campo non ce l'hanno (vedi §18).

**Struttura permessi consigliata:** vista la presenza di scoping per comunità e di operazioni distinte (read / upload / delete già trattate diversamente nelle regole), un **oggetto `permissions`** è più adatto di un singolo booleano, ma introducendolo **in modo incrementale**:
```jsonc
staff/{uid}.permissions = {
  documenti: { access: true, upload: false, delete: false }   // delete resta comunque solo super-user
}
```
con **fallback**: `permissions.documenti.access` assente ⇒ si ricade sulla regola attuale (`ruolo` coordinat/responsabil **oppure** `accessoDocumenti === true`). Così nessuno perde/acquista accesso al momento del rollout. Per questa milestone si può anche restare sul singolo `accessoDocumenti` e rimandare `permissions`.

---

## 6. COMUNITÀ — rappresentazione dell'appartenenza e cosa comporta uno spostamento

- **Canoniche** (`comunita` collection, `seed.py`): `bella-mbriana`, `itaca`, `willy-coyote`, `fortapasc`, `macrame`, `after-us`. **Da leggere sempre dalla collezione `comunita`**, non hardcodare (però `documenti.html` e `js/comunita.js` hardcodano l'elenco/emoji — da uniformare).
- Appartenenza ragazzo = **`utenti/{uid}.comunitaId`** (stringa singola). Appartenenza staff = `staff/{uid}.comunitaId` (stringa **o** array).
- **Cosa comporta spostare `comunitaId` fortapasc → itaca:**
  1. Il ragazzo compare/sparisce dagli elenchi (`minori.html?comunita=`, `ragazzi.html`, `documenti.html`) — **immediato, corretto**.
  2. Il **fascicolo Storage** resta sotto `documenti/fortapasc/{uid}/…` (il path non si sposta) ⇒ da `documenti.html` lo si vedrebbe cercando il ragazzo **sotto Itaca**, dove le cartelle non esistono ⇒ **fascicolo "perso" dalla UI** finché non si creano le cartelle sotto `itaca/{uid}` e/o si migrano i file. (**Non** migrare automaticamente senza decisione: vedi §11.)
  3. Le **schede PPU** già create restano `comunitaId=fortapasc` ⇒ non più leggibili dal coordinatore di Itaca (D3).
  4. `utenti_pin/{uid}.comunitaId` resta `fortapasc` (disallineato — è usato solo per display in Gestione ragazzi).
  5. `diario`, `messaggiBottiglia`, profilo, `interazioni` → **nessun impatto** (non contengono `comunitaId`). Identità e storico social **preservati**.

---

## 7. AFTER US — esiste già?

**Sì, ma solo come valore `comunitaId === 'after-us'`.** Nessuna collezione dedicata, nessun ruolo, nessun PIN "After Us" distinto, nessuna logica di "prosecuzione storia". Pagine coinvolte: `afterus.html` e `minori.html?comunita=after-us` (elenco), `comunita/after-us` (label, mutata in "Follow Up"). Alcuni `seed_*.py` creano direttamente `utenti` con `comunitaId:'after-us'`.

⇒ "Passare ad After Us" oggi = `updateDoc(utenti/{uid}, { comunitaId:'after-us' })`. Conserva UID, diario, messaggi, profilo. **Non** conserva la visibilità del fascicolo/PPU (D2/D3). Nessuno storico del passaggio.

---

## 8. PIN — cosa è riutilizzabile dal modello Robinson

| Aspetto | Robinson (`admin-pin.html`, `robinson/login.html`) | Campo dei Fiori ragazzi (`ragazzi-pin.js`, `gestione-ragazzi.html`) |
|---|---|---|
| Account | Auth reale, email sintetica `*.robinson@campodeifiori.org` | Auth reale, email sintetica `*.ragazzo@campodeifiori.org` |
| Password | `"RR" + pin` | `"CF" + pin` |
| PIN | 4 cifre | 6 cifre (login accetta 4–6) |
| Lookup pubblico | `robinson_pin_lookup/{pin}` = `{ uid, email, **password** }` ⚠️ chiaro | `utenti_pin_lookup/{pin}` = `{ uid, email }` (no password, ma `"CF"+pin` è derivabile) |
| PIN in chiaro | `robinson_pin/{uid}.pin` (admin-only) | `utenti_pin/{uid}.pin` (admin-only) |
| Login | client-side: legge lookup → `signInWithEmailAndPassword` | **identico** |
| lastLogin | `robinson_pin/{uid}.lastLogin` (best-effort) | `utenti_pin/{uid}.lastLogin` (best-effort, spesso fallisce: la regola è admin-only) |
| Rate-limit | nessuno | nessuno lato client (la Cloud Function ce l'ha ma non è usata) |
| Creazione/cambio/copia/genera/elimina | UI tabellare completa | UI a righe (`gestione-ragazzi.html`), senza "elimina" (solo archivia) |

**Riutilizzabile (UX):** la tabella `Foto | Nome | PIN (mostra/nascondi) | Ultimo accesso | Stato (Nessun PIN / Mai usato / Attivo) | Azioni (Copia / Cambia / Genera)`, i badge di stato, le statistiche in testa, il pulsante 🎲 genera. `gestione-ragazzi.html` ne ha già una versione: la Console può assorbirla/estenderla.

**Problemi di sicurezza del modello attuale (da NON copiare acriticamente):**
- **P1** — `utenti_pin_lookup` è **leggibile da chiunque** (`allow read: if true`), necessario per il login senza sessione. Chi enumera la collezione ottiene `{uid, email}` di **ogni** ragazzo; con `password = "CF"+pin` (formula nota) e un doc-id che **è** il PIN, un attaccante che indovina/enumera PIN a 6 cifre può fare login come qualunque ragazzo. Nessun rate-limit lato client. → il PIN **non deve** essere anche la password Firebase; serve una decisione (vedi §18). La Cloud Function `loginRagazzoConPin` già scritta è la mitigazione: PIN → custom token server-side, `utenti_pin_lookup` diventa **admin-only**, rate-limit per IP. **Ma** richiede il permesso IAM "Service Account Token Creator" sulla SA delle Functions (motivo probabile del revert).
- **P2** — PIN in chiaro in `utenti_pin`. Accettabile solo perché admin-only e serve a "ricomunicare il PIN". Alternativa: mostrare il PIN solo alla generazione, salvare hash. Da decidere (vedi §18).
- **P3** — `nomeToEmail` collide se due ragazzi hanno lo stesso nome ⇒ `signUp` fallisce con `EMAIL_EXISTS`. Serve disambiguazione (suffisso numerico).

---

## 9. FOTO — gestione attuale

- **Tutte** le immagini (profilo ragazzi/staff/amici, comunità, media diario/piazzetta) sono su **Cloudinary**, upload **unsigned** con preset `campo_dei_fiori` (`cloud_name dxqyprtzh`). URL salvato in `fotoProfilo` / `immagineUrl` / `media[]`.
- Firebase Storage **non** è usato per le foto (confermato dal commento in `storage.rules`: "foto e audio passano tutti da Cloudinary").
- `js/ragazzi-pin.js:uploadFotoCloudinary` e `js/profilo.js` fanno `POST` diretto all'endpoint Cloudinary.
- **Nessun controllo** server-side di MIME/dimensione: il preset unsigned accetta qualunque upload da qualunque origine che conosca `cloud_name` + preset (entrambi nel sorgente pubblico). Fallback UI: emoji `🧒`/`🤡`/`⚓`.

⇒ La Console può continuare con Cloudinary (coerenza) oppure spostare le foto ragazzi su Storage con regole MIME/size. Decisione in §18. Riutilizzabile: `cambiaFotoRagazzo(uid, file)` già pronto.

---

## 10. RISCHI (solo quelli rilevati dal codice)

| ID | Rischio | Evidenza | Gravità |
|---|---|---|---|
| R1 | **Privilege escalation via `isOwner` su `utenti`**: `firestore.rules:21` lascia il proprietario aggiornare **qualsiasi** campo del proprio `utenti/{uid}`. Un ragazzo PIN può auto-impostare `accessoDocumenti:true` (→ UI Documenti, R-D1), `stato:'attivo'` (annulla archiviazione → riabilita login PIN), `comunitaId` (si sposta di comunità da solo), `ruolo:'admin'` (→ alcune regole Robinson usano `get(utenti/{uid}).data.ruolo=='admin'` per `delete`/`update`: `robinson_dicono`, `notte_partenza`). | `firestore.rules` righe 18-24, 294-295, 336-342; `documenti.html` 823; `nav-docs.js` 45 | **Alta** |
| R2 | **Login PIN ragazzi enumerabile/spoofabile**: `utenti_pin_lookup` world-readable, doc-id = PIN, password = `"CF"+pin` derivabile, nessun rate-limit client. | `firestore.rules` 68-71; `js/ragazzi-pin.js` 163-191 | **Alta** |
| R3 | **Fascicolo/PPU orfani dopo trasferimento o passaggio After Us** (D2, D3): dati non cancellati ma non più raggiungibili/leggibili da chi segue il ragazzo. | `documenti.html` 327,406,519; `firestore.rules` 112-143 | **Media** |
| R4 | **Admin single point of failure / hardcoded**: UID admin ripetuto in 10+ file (regole incluse). Nessun modo di aggiungere un secondo admin senza deploy di codice **e** regole. Secondo UID hardcoded (`isMassimo`) in `storage.rules` per il solo delete. | `firestore.rules` 6; `storage.rules` 6-16; vari HTML | **Media** |
| R5 | **Modello ruoli fragile**: `staff.ruolo` è stringa libera, il match è per substring `coordinat`/`responsabil`. Un ruolo scritto diversamente ("Referente", "Resp.") non è riconosciuto; una comunità non impostata su `staff.comunitaId` fa fallire lo scoping (in passato "funzionava" solo per un catch-all poi rimosso). | `storage.rules` 41-49; `update_ruoli_staff.py`; `documenti.html` 815-819 | **Media** |
| R6 | **Nessun audit log** su operazioni sensibili (upload/delete documenti, cambio permessi, trasferimenti, cambio PIN, creazione utenti). | assenza in tutto il repo | **Media** |
| R7 | **PIN in chiaro** in `utenti_pin` e (Robinson) `robinson_pin` + password in chiaro in `robinson_pin_lookup`. | `firestore.rules` 58-60; `robinson/admin-pin.html` 527-531 | **Media** |
| R8 | **Cloudinary upload unsigned** senza validazione MIME/size, preset nel sorgente. | `js/ragazzi-pin.js` 52-60 | **Media** |
| R9 | **`identitytoolkit` REST dal browser con Web API key** per creare/cambiare account ragazzi da `gestione-ragazzi.html`. Funziona ma: (a) l'admin crea account senza rate-limit/verifica; (b) qualunque codice sul dominio può fare `signUp`. La API key è comunque pubblica per definizione (client Firebase). | `js/ragazzi-pin.js` 62-71, 83-84, 125-130 | **Bassa-Media** |
| R10 | **Codice morto** `loginRagazzoConPin` (Cloud Function) non collegato: confonde il modello di sicurezza (sembra esserci un login server-side che invece non è attivo). | `functions/index.js` 29; `functions/pinLogin.js`; `login.html` 66 | **Bassa** |
| R11 | **`.firebase-service-account.json` nella working dir** (gitignored ma presente su disco nella cartella di progetto). | root repo | **Bassa** |
| R12 | **Config Firebase duplicata** inline in ~15 HTML + 2 varianti web-app (principale/Robinson): una modifica va replicata ovunque; disallineamenti già presenti (`storageBucket` diverso in Robinson). | ogni HTML | **Bassa** |
| R13 | **`utenti` contiene tipi eterogenei** (ragazzi, After Us, naufraghi/ciurma Robinson): query "tutti i ragazzi" oggi filtra per `comunitaId` presente e `id !== ADMIN_UID` (`gestione-ragazzi.html:234`). Un naufrago Robinson senza `comunitaId` è escluso "per fortuna", non per design. | `gestione-ragazzi.html` 230-236 | **Bassa** |

---

## 11. TRASFERIMENTI E STORICO (analisi esplicita richiesta dal brief)

**Come i dati storici salvano `comunitaId` oggi:**
- `ppu_schede_a` / `ppu_schede_b`: `comunitaId` **scritto alla creazione** (`community.id` in `documenti.html:519`), **immutabile** per regola. ⇒ una scheda "appartiene" per sempre alla comunità in cui è stata compilata. **Corretto** rispetto al principio "non riscrivere il passato" — ma isola le schede vecchie dal nuovo coordinatore (D3/R3).
- Storage `documenti/{comunitaId}/{uid}/…`: `comunitaId` è nel **path**, quindi "storicizzato" implicitamente ma **non spostabile senza copiare i blob**.
- `diario` / `messaggiBottiglia` / `piazzetta_posts` / `interazioni`: **nessun** `comunitaId`. Nessun rischio di update di massa perché il campo non esiste; ma nessuna storicizzazione.
- `utenti.comunitaId`: **stato corrente** (mutabile), nessuno storico.

**Preferenza progettuale (coerente col brief) — da confermare:** introdurre uno **storico append-only** senza toccare i dati esistenti:
```jsonc
utenti/{uid}.comunitaId = "itaca"           // resta: stato corrente, per compatibilità con tutte le query esistenti
utenti/{uid}/appartenenze/{autoId} = {       // NUOVA sub-collection, opzionale
  comunitaId: "fortapasc", dal: <ts>, al: <ts|null>, causale: "trasferimento", operatore: <uid>
}
```
- Le schede PPU **non** vengono toccate: restano con il loro `comunitaId` originale (evento storico).
- Per risolvere D3 senza riscrivere nulla: la vista PPU della Console (o `documenti.html`) può, **per l'admin e per il coordinatore attuale**, elencare le schede di **tutte** le comunità in cui il ragazzo è transitato (unendo `where('minorId','==',uid)` su tutti i suoi `comunitaId` storici). Richiede un **adeguamento delle regole** `ppu_schede_*` (consentire read se il richiedente è coord/responsabile di **una qualsiasi** comunità nello storico del `minorId`) — oppure lasciare l'accesso storico al solo admin (più semplice, meno invasivo).
- Fascicolo Storage: **decisione richiesta** (§18) se al trasferimento (a) si copiano i blob sotto la nuova comunità, (b) si lasciano dove sono e la Console li mostra comunque risalendo allo storico, (c) si introduce `documenti/{uid}/…` senza comunità nel path (migrazione grossa, sconsigliata ora).

---

## 12. AUDIT LOG (proposta livello minimo)

Collezione **`admin_audit`** (append-only), un doc per operazione sensibile:
```jsonc
admin_audit/{autoId} = {
  ts: serverTimestamp(),
  actorUid: <uid>,              // chi
  actorNome: <string>,
  action: "transfer" | "afterus" | "perm.documenti.grant" | "perm.documenti.revoke"
        | "pin.create" | "pin.change" | "user.create" | "user.archive" | "doc.delete",
  targetType: "utenti" | "staff" | "file",
  targetId: <uid|path>,
  details: { from: "fortapasc", to: "itaca" }   // libero, minimale
}
```
Regole: `create if isAdmin()` (o attore autorizzato), `read if isAdmin()`, **no update/delete**. Nessun sistema di tamper-proofing, nessuna retention automatica: è un registro operativo, non forense. Scrittura **best-effort dal client** per la milestone 1; se in futuro si introduce un backend, spostare la scrittura lì.

---

## 13. PROTEZIONE DEI DATI (minori)

La Console deve governare **identità / appartenenza / accessi / permessi / stato / PIN / foto** e **NON** diventare un visualizzatore di contenuti educativi. In particolare:
- **Non** mostrare nella Console il contenuto delle schede PPU, del diario, delle osservazioni. Al massimo: *conteggio* schede PPU per ragazzo (per capire se un trasferimento lascia dati indietro), senza aprirle.
- La lista ragazzi mostra: foto, nome, comunità, stato, PIN (mascherato, con toggle admin), ultimo accesso. Niente dati sanitari/familiari/psicologici.
- Minimo privilegio: le operazioni di trasferimento/After Us/permessi sono **solo admin** in milestone 1.

---

## 14. COMPATIBILITÀ (strategia di non-regressione)

| Nuovo elemento | Utenti/documenti privi del campo | Comportamento da garantire |
|---|---|---|
| `staff.permissions.documenti.access` (se introdotto) | assente sui doc `staff` esistenti | **Fallback alla regola attuale** (`ruolo` coordinat/responsabil **OR** `accessoDocumenti===true`). Nessuna revoca, nessuna concessione. |
| `staff.accessoDocumenti` come unico flag milestone 1 | già assente su molti staff | Chi ha `ruolo` coordinat/responsabil **continua** ad avere accesso a prescindere. Chi non ce l'ha e non ha il flag: **nessun accesso** (come oggi). La Console si limita a rendere il flag **settabile**. |
| `utenti/{uid}/appartenenze` (storico) | nessun ragazzo ce l'ha | Assenza = "una sola appartenenza, quella corrente in `comunitaId`, da data ignota". Nessuna query esistente cambia. |
| `admin_audit` | — | Collezione nuova, nessun impatto. |
| Blindatura `firestore.rules` su `utenti` (R1) | tutti i ragazzi | **Attenzione**: restringere `allow update` su `utenti` **non deve** rompere: (a) il toggle `reazioniPresento` (già gestito), (b) `js/profilo.js` che scrive `fotoProfilo`/`miPresento` sul **proprio** doc, (c) `nav-auth.js` che scrive `primoAccesso`, (d) `auth.js` che incrementa `numeroAccessi`, (e) FCM token. ⇒ la nuova regola deve elencare i campi **self-service consentiti** e vietare i campi di sistema (`comunitaId`, `stato`, `admin`, `ruolo`, `accessoDocumenti`, `permissions`, `email`). |
| Default accesso Documenti | — | **Nessun cambiamento implicito.** Prima del rollout: fare un censimento (`staff` con `ruolo` coord/resp e `staff` con `accessoDocumenti`) e verificare che l'insieme "chi può oggi" == "chi potrà domani". |

---

## 15. TEST (piano minimo, mappato ai 16 punti del brief)

1. **admin apre Console** — login `mCSg…` → home Console visibile.
2. **utente normale NON apre Console** — staff non-admin, ragazzo PIN, amico, anonimo → tutti `accesso negato`; URL diretto `console.html` → negato.
3. **admin vede elenco ragazzi** — lista da `utenti` con `comunitaId` presente, esclusi staff/naufraghi.
4. **trasferimento conserva identità** — `comunitaId` cambia, `uid` invariato, `diario`/`messaggiBottiglia`/`profilo` intatti; (se adottato) nuovo record in `appartenenze`.
5. **trasferimento non cancella dati collegati** — count schede PPU prima == dopo; blob Storage prima == dopo; nessun `deleteDoc`.
6. **passaggio After Us conserva identità** — `comunitaId='after-us'`, `uid` invariato, storico PPU ancora esistente (anche se non mostrato).
7. **PIN** — genera (unicità su `utenti_pin`), cambia (vecchia pwd → nuova), copia, toggle mostra/nascondi, stato "Mai usato"/"Attivo" da `lastLogin`.
8. **foto** — upload → `utenti/{uid}.fotoProfilo` aggiornato, avatar ovunque; fallback emoji se assente.
9. **utente autorizzato apre Documenti** — staff coord/resp o `accessoDocumenti` → UI + download OK **nella propria comunità**.
10. **utente non autorizzato NON apre Documenti** — staff senza ruolo/flag → `accesso negato`; ragazzo PIN → negato.
11. **URL diretto Documenti respinto** — `documenti.html` con sessione non autorizzata → `showAccessDenied`.
12. **accesso Storage/Firestore non autorizzato respinto** — `getDownloadURL` su `documenti/altraComunita/**` da coordinatore fuori scope → `permission-denied`; `getDoc` su `ppu_schede_a` fuori scope → denied; **(regressione R1)** ragazzo che fa `updateDoc(utenti/self,{accessoDocumenti:true})` → **deve** essere `permission-denied` dopo il fix.
13. **revoca permesso Documenti produce effetto** — tolto il flag / `permissions.access=false` → al reload, `documenti.html` nega e Storage nega.
14. **utenti esistenti continuano a funzionare** — staff coord senza `permissions` accede ancora (fallback §14); ragazzi loggano ancora via PIN; `profilo.js` scrive ancora `miPresento`/`fotoProfilo`.
15. **nessuna regressione PPU** — creazione/lettura schede A e B invariata per staff in scope; `montaElenco` funziona da `documenti.html`.
16. **nessuna regressione autenticazione** — login email staff, login PIN ragazzo, logout, `onAuthStateChanged`, redirect, `numeroAccessi++`, `primoAccesso`.

Non esiste una suite test nel repo (nessun `test/`, nessun runner). Milestone 1: test **manuali guidati** + un piccolo script Node con Firestore emulator per i casi 12/14 (regole). Definire se si vuole introdurre l'emulator suite.

---

## 16. PROPOSTA DI ARCHITETTURA (minima, non distruttiva)

**Principio:** la Console è una **nuova pagina** che *orchestra* operazioni già possibili sul modello attuale, aggiungendo solo: (a) un check ruolo affidabile, (b) 2 campi opzionali (`staff.accessoDocumenti` reso gestibile; `utenti/{uid}/appartenenze` opzionale), (c) una collezione audit.

```
console.html                         ← nuova, unica pagina (SPA a sezioni)
  └─ js/console/
       admin-guard.js                ← unico punto di verità: isAdmin(user) → UID hardcoded OR staff/{uid}.admin===true
                                        (allineare firestore.rules per accettare anche staff.admin===true)
       identity.js                   ← modello persona unificato: legge utenti/staff/amici, normalizza
       ragazzi.js                    ← lista + azioni (riusa js/ragazzi-pin.js as-is)
       comunita.js                   ← vista per comunità (legge collezione `comunita`, niente hardcode)
       afterus.js                    ← wrapper di "transfer verso after-us" + eventuale PIN
       operatori.js                  ← lista staff read-only + toggle accessoDocumenti
       permessi.js                   ← UI del flag Documenti (milestone 1: un booleano per staff, con scoping comunità già gestito dalle regole)
       transfer.js                   ← cambio comunitaId + scrittura appartenenze + admin_audit
       audit.js                      ← scrittura best-effort admin_audit
```

**Riuso diretto:** `js/ragazzi-pin.js` (creazione/PIN/foto/archiviazione), UX di `robinson/admin-pin.html` (tabella), `js/comunita.js` (lettura comunità).

**Modello ruolo admin (scelta consigliata):**
`isAdmin(user)` = `user.uid === ADMIN_UID` **OR** `staff/{user.uid}.admin === true`.
Adeguare `firestore.rules`:
```
function isAdmin() {
  return request.auth != null && (
    request.auth.uid == 'mCSgNMVEphVIIf4HX0bkcKq2ZKv2' ||
    get(/databases/$(database)/documents/staff/$(request.auth.uid)).data.get('admin', false) == true
  );
}
```
Così si può nominare un secondo admin **da Firestore** (o dalla Console) senza deploy di codice. `custom claims` sarebbe più pulito ma richiede un backend/script per settarli: **non** introdurlo ora (vedi §18).

---

## 17. FILE DA MODIFICARE / CREARE

### Da CREARE
| File | Perché |
|---|---|
| `console.html` | Home Console Admin (sezioni: Ragazzi / Comunità / After Us / Operatori / Permessi / Documenti). |
| `js/console/admin-guard.js` | Verifica admin unica e riusabile. |
| `js/console/identity.js` | Normalizzazione persona (utenti/staff/amici). |
| `js/console/ragazzi.js`, `comunita.js`, `afterus.js`, `operatori.js`, `permessi.js`, `transfer.js`, `audit.js` | Logica per sezione. |
| `AUDIT-CONSOLE-ADMIN.md` | Questo documento (già creato). |
| *(opz.)* `test/rules.spec.mjs` + `firebase.json` emulator block | Test regole per casi 12/14. |

### Da MODIFICARE
| File | Modifica | Rischio |
|---|---|---|
| `firestore.rules` | (a) `isAdmin()` accetta `staff.admin===true`; (b) **restringere `allow update` su `utenti/{uid}`** a campi self-service (fix R1); (c) *(se storico PPU cross-comunità)* ampliare read su `ppu_schede_*`; (d) regole per `admin_audit`; (e) *(se `appartenenze`)* regole sub-collection. | **Alto** — mostrare diff completa, testare con emulator, deploy solo dopo ok. |
| `js/nav-docs.js` | Leggere `accessoDocumenti` **solo** da `staff` (non `utenti`/`amici`); allineare a `admin-guard`. | Basso |
| `documenti.html` | (a) gate: `accessoDocumenti` solo da `staff` (fix D1); (b) includere `after-us` tra le comunità navigabili per l'admin (fix D2); (c) *(opz.)* vista storico PPU cross-comunità. | Medio |
| `gestione-ragazzi.html` | Assorbita/linkata dalla Console; aggiungere azioni "Cambia comunità" e "Passa ad After Us" (oggi assenti). | Basso |
| `js/ragazzi-pin.js` | (a) disambiguare `nomeToEmail` in caso di collisione (fix P3); (b) esporre `trasferisciRagazzo(uid, nuovaComunita)` che aggiorna `utenti.comunitaId` + `utenti_pin.comunitaId` + `appartenenze` + `admin_audit`. | Basso |
| `index.html` (+ altre nav) | Voce "Console Admin" visibile solo se `isAdmin` (riusa `nav-gestione-link`). | Basso |
| `.gitignore` / repo | Rimuovere `.firebase-service-account.json` dalla working dir (spostarlo fuori progetto). | Nullo |

### Da NON toccare (in milestone 1)
`functions/**` (nessuna nuova function), `js/ppu-scheda-a.js` / `js/ppu-scheda-b.js` (logica PPU), `storage.rules` (già corretto; unica eccezione: se si decide la copia blob al trasferimento, allora servirà valutarlo), tutti i `robinson/**`, tutti gli `seed_*` / `update_*`.

---

## 13-bis. MODIFICHE FIRESTORE (campi/collezioni nuove) — riepilogo

| Collezione/campo | Tipo | Default per doc esistenti | Obbligatorio in milestone 1? |
|---|---|---|---|
| `staff/{uid}.accessoDocumenti` | bool | assente ⇒ fallback su `ruolo` coordinat/responsabil | **Sì** (reso gestibile da UI; già esiste come concetto) |
| `staff/{uid}.admin` | bool | già presente, quasi sempre `false` | **Sì** (usato dal nuovo `isAdmin()`) |
| `admin_audit/{autoId}` | collezione | — | Consigliato |
| `utenti/{uid}/appartenenze/{autoId}` | sub-collection | assente ⇒ "solo appartenenza corrente" | Opzionale (consigliato per lo storico) |
| `staff/{uid}.permissions.documenti.{access,upload,delete}` | map | assente ⇒ fallback | **No** — rimandabile a milestone 2 |

Nessun campo esistente viene **rinominato** o **rimosso**. Nessuna migrazione dati obbligatoria: tutti i nuovi campi hanno un default retro-compatibile.

---

## 14-bis. MODIFICHE AUTHENTICATION — servono davvero?

**No, non in milestone 1.**
- Non serve creare account Auth per ogni ragazzo "a prescindere": si creano **solo quando si assegna un PIN** (comportamento attuale, corretto).
- Non serve introdurre custom claims ora (richiederebbe backend/script per settarli).
- La creazione/cambio PIN via `identitytoolkit` REST dal browser **funziona** ed è l'unico modo senza Admin SDK. Va **tenuta** in milestone 1, con la sola aggiunta della disambiguazione email (P3).
- **Se** in futuro la Console dovrà **disabilitare** un account Auth, cambiare email, o **cancellare** un account: allora **sì**, serve un backend protetto (vedi §16-bis) — ma non è richiesto ora (oggi si "archivia" via `stato`, senza toccare Auth).

---

## 16-bis. CLOUD FUNCTIONS / BACKEND — servono?

**Milestone 1: no.** Tutte le operazioni (trasferimento, After Us, toggle permesso, PIN, foto, archiviazione, audit best-effort) sono fattibili client-side con le regole adeguate.

**Servirebbe un backend protetto (Cloud Function callable + Admin SDK + verifica `isAdmin`) SOLO per, in futuro:**
- disabilitare / riabilitare / cancellare account Firebase Auth di altri utenti;
- cambiare la password/PIN **senza** conoscere quella vecchia (oggi `cambiaPinRagazzo` deve fare login con la vecchia);
- rate-limit reale sul login PIN + `utenti_pin_lookup` reso admin-only (è **esattamente** ciò che fa `functions/pinLogin.js`, già scritto ma non collegato — da riattivare **se** si concede alla SA il ruolo *Service Account Token Creator*);
- scrittura audit log server-side non falsificabile.

**Vincolo:** nessuna service account key / private key nel frontend (già rispettato: gli unici usi sono script locali fuori dall'app servita).

---

## 18. PUNTI CHE RICHIEDONO UNA TUA DECISIONE (solo scelte non deducibili dal codice)

1. **PIN = password Firebase?** Oggi sì (`"CF"+pin`), con `utenti_pin_lookup` pubblico e nessun rate-limit (R2/P1). Opzioni:
   (a) **tenere così** (semplice, UX invariata, rischio accettato);
   (b) **riattivare la Cloud Function** `loginRagazzoConPin` (PIN→custom token, lookup admin-only, rate-limit) — richiede il ruolo IAM *Service Account Token Creator* sulla SA delle Functions;
   (c) allungare i PIN / aggiungere lockout client-side come palliativo.
   → *Serve la tua scelta.*

2. **PIN in chiaro in `utenti_pin`** (R7): mantenere (per poterlo ricomunicare) o salvare solo hash e mostrarlo unicamente alla generazione/rigenerazione?

3. **Secondo admin**: va bene `staff.admin === true` come criterio (gestibile da Firestore/Console), o preferisci custom claims (più sicuro ma richiede uno script/back-office per assegnarli)?

4. **Trasferimento di comunità — fascicolo Storage** (`documenti/{comunitaId}/{uid}/…`): al trasferimento
   (a) si **copiano** i file sotto la nuova comunità (storia "segue" il ragazzo, ma duplica blob),
   (b) si **lasciano dove sono** e la Console/`documenti.html` li mostra risalendo allo storico appartenenze (nessuna copia, ma serve adeguare regole + UI),
   (c) altro?

5. **Storico PPU cross-comunità** (D3): dopo un trasferimento, le schede vecchie devono essere leggibili
   (a) **solo dall'admin** (minimo intervento sulle regole),
   (b) **anche dal coordinatore attuale** del ragazzo (serve ampliare `ppu_schede_*` read con lo storico `appartenenze`),
   (c) restano com'è (solo staff della vecchia comunità + admin)?

6. **Storico appartenenze**: introdurre `utenti/{uid}/appartenenze` (append-only) da subito, o rimandare e per ora tracciare i trasferimenti **solo** in `admin_audit`?

7. **After Us**: è sempre e solo `comunitaId='after-us'` (come oggi), oppure vuoi un campo `stato='afterus'` separato da `comunitaId` (così After Us può conservare l'ultima comunità di provenienza in `comunitaId` e diventare un *flag di stato*)? La seconda è più espressiva ma tocca tutte le query che oggi filtrano `comunitaId==='after-us'` / `!== 'after-us'` (`ragazzi.html`, `afterus.html`, `minori.html`, `create_area_folders.py`).

8. **Foto ragazzi**: restare su Cloudinary unsigned (coerenza, zero lavoro) o migrare le foto ragazzi su Firebase Storage con regole MIME/dimensione (più controllo, ma nuovo codice e nuove regole)?

9. **Permessi Documenti — granularità milestone 1**: basta `accessoDocumenti` (booleano, scoping comunità già nelle regole) o vuoi già l'oggetto `permissions.documenti.{access,upload,delete}`?

10. **`gestione-ragazzi.html`**: la Console la **assorbe** (una sola pagina `console.html`) o la **linka** come sotto-pagina mantenendola separata?

11. **Ambito "Operatori" in Console**: sola lettura (nome, email, UID, ruolo, comunità, `accessoDocumenti`, ultimo accesso) — confermi che **non** serve creare/modificare/eliminare staff dalla Console in milestone 1 (resta via script)?

12. **Test**: introduciamo il Firebase emulator per testare le nuove regole (casi 12 e 14), o milestone 1 procede con soli test manuali guidati?

---

## STOP

Fine PRIMA CONSEGNA OBBLIGATORIA. **Nessuna implementazione avviata.** In attesa della tua approvazione del report e delle decisioni §18 prima di procedere con il piano di milestone dettagliato e le modifiche.
