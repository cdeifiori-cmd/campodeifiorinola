# Console Admin Campo dei Fiori — Piano e decisioni

Branch: `feat/console-admin` · Worktree: `F:/campodeifiori-console` · Base: `4736ba4`
Documento di audit completo: [`AUDIT-CONSOLE-ADMIN.md`](AUDIT-CONSOLE-ADMIN.md)

---

## Decisioni funzionali approvate (rif. §18 dell'audit)

| # | Tema | Decisione |
|---|---|---|
| 1 | **PIN / login ragazzi** | Direzione: **Cloud Function `loginRagazzoConPin`** (già nel repo), da attivare in Milestone E dopo verifica integrale di sicurezza + prerequisito IAM *Service Account Token Creator*. Nessuna modifica IAM autonoma. Il PIN resta l'unica credenziale mostrata all'utente. |
| 2 | **PIN recuperabile** | Il PIN resta recuperabile dall'admin in `utenti_pin` (mostra/nascondi, copia, cambia, genera, ultimo accesso, stato Mai usato/Attivo), ma `utenti_pin` **solo admin** e `utenti_pin_lookup` non deve più essere vettore di enumerazione pubblica. (Implementazione: Milestone E.) |
| 3 | **Admin** | `isAdmin() = legacy ADMIN_UID OR staff/{uid}.admin === true` (null-safe). Legacy UID mantenuto come fallback; hardcoding negli altri file **non** rimossi ora. La Console permette all'admin di attribuire/revocare `admin` a uno staff, con protezione "ultimo admin" (non ci si può auto-revocare se si resterebbe senza admin). |
| 4 | **Documenti** | Milestone 1: solo booleano esistente `staff.accessoDocumenti` (ON/OFF in Console, modificabile solo da admin). Nessun `permissions.documenti.{}` per ora. **Fix obbligatorio D1/R1**: `utenti/{uid}` (e staff/amici) non può auto-modificare campi di sistema. Whitelist self-service esplicita, testata con emulator. |
| 5 | **Storico appartenenze** | Subcollection `utenti/{uid}/appartenenze/{id}` append-only da subito: `comunitaId, dal, al, causale, actorUid, createdAt`. `utenti.comunitaId` resta la comunità corrente. Trasferimento = chiude precedente + apre nuova + aggiorna `utenti.comunitaId` + aggiorna `utenti_pin.comunitaId` + audit log. Nessun cambio UID/Auth, nessuna modifica PPU storiche, nessuna cancellazione. Gestire utenti privi della subcollection. |
| 6 | **After Us** | Resta `comunitaId === 'after-us'` (nessuno stato separato). Il passaggio è un trasferimento particolare registrato nello storico. Possibile creare un utente direttamente in After Us (nome, foto, PIN, `comunitaId=after-us`). |
| 7 | **Documenti dopo trasferimento** | **Nessuna copia/spostamento blob Storage.** I file restano sotto `documenti/{comunitaVecchia}/{uid}/…`. La nuova UI Documenti ricostruisce le appartenenze storiche e rende accessibile il fascicolo pregresso agli autorizzati. Studio Storage Rules dedicato in Milestone G. |
| 8 | **PPU dopo trasferimento** | `comunitaId` delle schede storiche **mai** modificato. Policy: admin vede tutto; coordinatore/responsabile della comunità **attuale** del ragazzo può vedere anche lo storico PPU; altri operatori restano nel proprio scope. Da implementare **solo** se esprimibile con Firestore Rules sicure; altrimenti fermarsi e proporre il minimo dato derivato. (Milestone G.) |
| 9 | **Foto** | Restare su Cloudinary (no migrazione a Storage). Riuso `cambiaFotoRagazzo(...)`. Aggiungere se possibile: controllo tipo file, limite dimensione, preview. Nessuna modifica al preset Cloudinary. (Milestone F.) |
| 10 | **Console vs gestione-ragazzi** | La Console **assorbe** `gestione-ragazzi.html`. La vecchia pagina resta fisicamente per retrocompatibilità durante lo sviluppo, non viene ancora eliminata. |
| 11 | **Operatori** | Sezione Operatori: visualizza nome/email/UID/ruolo/comunità/accessoDocumenti/admin; l'admin può modificare ruolo, comunità, accessoDocumenti, admin. **Niente** creazione/cancellazione/reset password Auth staff (milestone server-side successiva). |
| 12 | **Test** | Firebase Emulator per le Security Rules critiche, con guardia anti-produzione. |

---

## Roadmap milestone

| Milestone | Contenuto | Stato |
|---|---|---|
| **A** | Isolamento worktree · Security Rules (isAdmin, fix R1/D1 su utenti/staff/amici, appartenenze, admin_audit) · Firebase Emulator · test automatici · documentazione | **in corso** |
| B | Struttura Console (`console.html`) · admin guard · elenco Ragazzi/Operatori in sola lettura | — |
| C | Permesso Documenti ON/OFF (UI, solo admin) · scrittura `admin_audit` | — |
| D | Trasferimenti · storico appartenenze · After Us | — |
| E | Gestione PIN · integrazione Cloud Function `loginRagazzoConPin` sicura | — |
| F | Foto (tipo/dimensione/preview) · rifinitura UX | — |
| G | Accesso storico Documenti/PPU dopo trasferimento (Storage Rules + Firestore Rules) | — |

Dopo **ogni** milestone: file modificati → diff sintetica → test → risultati → `git status` → **nessun deploy** → STOP e attesa approvazione.

---

## MILESTONE A — registro delle modifiche

**Ambito:** solo Security Rules + infrastruttura di test. Nessun file applicativo (`*.html`, `js/*` dell'app) toccato. Nessun deploy.

### File

| File | Tipo | Contenuto |
|---|---|---|
| `firestore.rules` | modifica | `isAdmin()` (legacy OR `staff.admin===true`, null-safe); whitelist self-service `utenti`/`staff`/`amici` (fix R1/D1); subcollection `utenti/{uid}/appartenenze` (create solo admin, update solo campo `al`, delete vietato); collezione `admin_audit` (append-only assoluto) |
| `firebase.json` | modifica additiva | blocco `emulators` (firestore:8080, auth:9099, ui off, singleProjectMode) |
| `package.json` | modifica | `devDependencies`: `@firebase/rules-unit-testing`, `firebase`, `firebase-tools`; script `test:rules` |
| `.gitignore` | modifica | ignora i log dell'emulatore |
| `test/rules/helpers.mjs` | nuovo | setup emulatore + **guardia anti-produzione** + seed identità |
| `test/rules/utenti.test.mjs` | nuovo | fix R1/D1 su `utenti` |
| `test/rules/staff-amici.test.mjs` | nuovo | fix R1 su `staff` e `amici` |
| `test/rules/appartenenze.test.mjs` | nuovo | regole subcollection appartenenze |
| `test/rules/admin-audit.test.mjs` | nuovo | append-only `admin_audit` |
| `test/rules/documenti-ppu.test.mjs` | nuovo | nessuna regressione PPU + admin nuovo modello |
| `test/README.md` | nuovo | come eseguire i test |
| `AUDIT-CONSOLE-ADMIN.md` | copiato nel branch | audit completo |
| `CONSOLE-ADMIN-PLAN.md` | nuovo | questo documento |

### Whitelist self-service definitive (ricavate dai writer client-side reali)

Writer analizzati: `js/auth.js` (`numeroAccessi`), `js/nav-auth.js` (`primoAccesso`), `js/notifiche.js` (`fcmTokens`,`fcmToken`), `profilo.html` (`fotoProfilo`,`fotoCover`,`miPresento`,`updatedAt`,`audioUrl`, e `interazioni.*` via `incrInt()` **sul proprio doc**, mai su `amici`).

| Collezione | Campi self-service consentiti al **proprietario** | Note |
|---|---|---|
| `utenti/{uid}` | `numeroAccessi`, `primoAccesso`, `fcmTokens`, `fcmToken`, `fotoProfilo`, `fotoCover`, `miPresento`, `updatedAt`, `audioUrl`, `interazioni` | + clausola invariata: *qualsiasi loggato* può `hasOnly(['reazioniPresento'])` (reazioni alla "Mi Presento" altrui) |
| `staff/{uid}` | `numeroAccessi`, `fcmTokens`, `fcmToken`, `fotoProfilo`, `fotoCover`, `miPresento`, `updatedAt`, `audioUrl`, `interazioni` | nessuna clausola `reazioniPresento` (come oggi: per `staff` era già negata) |
| `amici/{uid}` | `fcmTokens`, `fcmToken`, `fotoProfilo`, `fotoCover`, `miPresento`, `updatedAt`, `audioUrl` | niente `interazioni`/`numeroAccessi`: nessun writer client li tocca su `amici` |

**Campi di sistema (mai auto-scrivibili, solo admin):** `nome`, `email`, `comunitaId`, `stato`, `admin`, `ruolo`, `accessoDocumenti`, `permissions`, `createdAt`, `autorizzato`, `anteprima`, `fotoPosition`, `lastLogin`, `comunita`.

**Scelta motivata su `interazioni`** (unico campo "ambiguo"): è un contatore **cosmetico** mostrato ai soli admin. Il client lo incrementa solo sul proprio documento (`incrInt(currentUser.uid, …)`); gli incrementi cross-utente (`incrInt(profileUid, …)`) **già oggi falliscono in silenzio** perché le regole precedenti non li ammettevano, e **restano vietati** (nessuna clausola cross-utente aggiunta). Non è un campo di privilegio: includerlo nella whitelist del proprietario non apre alcuna superficie di attacco.

> **NOTA (decisione §18.4) — `interazioni` è un dato _client-derived_.**
> Il campo `interazioni.*` è scritto dal browser dell'utente sul proprio
> documento e **NON deve essere considerato una metrica amministrativa
> affidabile né security-sensitive**: un utente può alterare i propri
> contatori. È tollerato nella whitelist self-service solo perché non
> determina privilegi/autorizzazioni ed è usato unicamente per badge
> cosmetici visibili agli admin.
> Se in futuro `interazioni` dovesse acquisire valore amministrativo o
> statistico, la sua scrittura dovrà spostarsi **lato server** (Cloud
> Function / Admin SDK) e il permesso client dovrà essere revocato. In
> nessun caso va ampliato il permesso a scritture cross-utente.

### Note operative
- `js/profilo.js` (11 KB) risulta **non importato da nessuna pagina servita**: la pagina profilo reale è `profilo.html` (self-contained). I suoi writer sono comunque un sottoinsieme di quelli di `profilo.html`.
- Pagine-utility non collegate alla navigazione (`add-giuseppe.html`, `admin-update-foto.html`) non sono state analizzate a fondo: dopo il fix funzioneranno solo se eseguite da admin o dal proprietario. Da rivedere se servono ancora.
- `robinson/**`: `robinson/naufrago.html` e `robinson/js/robinson-modal-profilo.js` scrivono `fotoProfilo` su `utenti/{uid}` (proprietario) — coperto dalla whitelist, nessuna regressione. Nessun file Robinson modificato.

---

## MILESTONE C — registro delle modifiche

**Ambito:** semantica TRI-STATE definitiva del permesso Documenti + azione Console (solo `accessoDocumenti`) + audit atomico. Nessuna modifica a PPU storiche, contenuti, schema; nessun Robinson; nessun deploy.

### Semantica tri-state (definitiva)

```
accesso Documenti/PPU =
  admin
  OR ( 'accessoDocumenti' presente sul doc staff
         ? accessoDocumenti === true          // true/false PREVALGONO sul ruolo
         : ruolo ~ /coordinat|responsabil/ )  // campo assente => fallback legacy
  , ristretto allo scope comunità (staff.comunitaId string|array; assente => nessuno scope => DENY)
```

Applicata in modo coerente in: `firestore.rules` (`canAccessPPU`), `storage.rules`
(`canAccessDocumentiComunita` / `canAccessDocumentiGenerali`), `documenti.html`
(gate `onAuthStateChanged`), `js/nav-docs.js` (visibilità link), Console
(`classifyDocumenti` → campo `effettivo`).

### File

| File | Modifica |
|---|---|
| `firestore.rules` | helper PPU riscritti tri-state (`staffDocumentiPolicyPPU`); `canAccessPPU = isAdmin() OR (policy AND scope)`. `admin_audit` create: vincoli `actorUid == request.auth.uid`, `ts == request.time`, chiavi minime presenti/tipate, `before`/`after` mappe. |
| `storage.rules` | helper staff riscritti tri-state (`staffDocumentiPolicy`, con `'accessoDocumenti' in staffData()` per distinguere "campo assente"); `canAccessDocumentiComunita = isSuperUser() OR (policy AND scope)`; `canAccessDocumentiGenerali = isSuperUser() OR policy`. `isAdmin()`/`isSuperUser()` **invariati** (solo UID legacy + Massimo). |
| `documenti.html` | +3 righe nel gate: `if (data.accessoDocumenti === false) break;` (il `false` nega anche a coord/resp). |
| `js/nav-docs.js` | +3 righe: `if (coll==='staff' && data.accessoDocumenti === false) break;` |
| `js/console/console-data.js` | `classifyDocumenti`: campo `effettivo` (era `effettivoOggi`) = esito tri-state; `NEGATO_ESPLICITO` ora `effettivo:false`. |
| `js/console/console-operatori.js` | `renderPermessi`: legenda aggiornata + per operatore i pulsanti **Concedi / Nega / Legacy** (conferma `window.confirm`, poi re-render). |
| `js/console/console-permessi.js` | **NUOVO.** `setAccessoDocumenti(uid, true|false|'legacy')` — unica funzione di scrittura. `writeBatch` atomico: `staff/{uid}.accessoDocumenti` (SOLO questo campo; `deleteField()` per 'legacy') + `admin_audit/{autoId}`. No-op guard se lo stato non cambia. |
| `console.html` | CSS pulsanti `.cperm-btn`. |
| `firebase.json` | emulatore `storage` (9199); `singleProjectMode: false` (necessario al cross-service `firestore.get` dello Storage emulator). |
| `package.json` | `test:rules`: aggiunge `storage` a `--only` e una seconda invocazione `node --test` dedicata alla suite Storage. |
| `test/rules/helpers.mjs` | config `storage` in `initializeTestEnvironment`; `getTestEnv(suite,{baseProject})`; `seedTriState()` (matrice coord/edu × assente/true/false, array, no-comunità). |
| `test/rules/documenti-ppu.test.mjs` | +matrice tri-state + scope + create/update. |
| `test/rules/admin-audit.test.mjs` | +vincoli integrità (actorUid, ts, campi, tipi). |
| `test/rules/staff-amici.test.mjs` | +§11 (admin update misto; staff non-admin non tocca il proprio `accessoDocumenti`). |
| `test/rules/storage-documenti.test.mjs` | **NUOVO.** Storage tri-state + scope + Generali + super-user. |

### Audit — schema e limiti

`admin_audit/{autoId}` = `{ ts: serverTimestamp(), actorUid, action, targetType:'staff', targetId, before:{accessoDocumenti}, after:{accessoDocumenti} }`.
`before`/`after` usano `null` per rappresentare "campo assente" (Firestore non memorizza `undefined`).
`action` ∈ `DOCUMENTI_ACCESS_GRANTED` | `DOCUMENTI_ACCESS_DENIED` | `DOCUMENTI_ACCESS_RESET_LEGACY`.

> **Questo audit NON è crittograficamente non-falsificabile.** `update`/`delete` sono
> vietati dalle Rules e il `create` è vincolato (actorUid == auth.uid, ts == request.time,
> forma minima), ma un admin compromesso può comunque creare voci arbitrarie ben formate.
> L'integrità forte richiederà una scrittura server-side (Admin SDK) in una milestone futura.

### Patch di chiusura Milestone C (fix `align admin access and document scopes`)

Corrette due incoerenze emerse nel report:

1. **ADMIN canonico ovunque.** `isAdmin() = legacy ADMIN_UID OR staff/{uid}.admin === true`
   ora è coerente in `firestore.rules` (già dalla Milestone A), **`storage.rules`**
   (nuovo: `firestore.exists` + `.data.get('admin', false)`), **`documenti.html`**
   (gate: `data.admin === true` sul doc staff), **`js/nav-docs.js`** (stesso check;
   il link Documenti compare anche per `staff.admin`), **Console**
   (`classifyDocumenti(staffData, uid)` marca ADMIN anche il legacy UID). Il
   fallback legacy resta. Un `admin === true` presente **solo** in `utenti`
   (nessun doc `staff`) **NON** è admin.
2. **Scope comunità per `accessoDocumenti === true`.** In `documenti.html`,
   quando l'accesso è concesso (esplicito `true` **o** fallback ruolo), `myComunita`
   è ricavato da `staff.comunitaId` (string → `[string]`, array → array, assente →
   `[]`). Un educatore con `accessoDocumenti:true` + `comunitaId:'itaca'` vede
   Itaca; con `['itaca','fortapasc']` vede entrambe; senza `comunitaId` non ha
   comunità navigabili. **Nessuno scope globale** per il solo `accessoDocumenti:true`.

Tri-state invariato (assente→ruolo, true→sì, false→no che prevale, admin→globale).

### Note / gap noti (da riprendere)

- Audit non crittograficamente non-falsificabile (vedi sopra): integrità forte →
  scrittura server-side in una milestone futura.

---

## MILESTONE D — trasferimenti · After Us · storico appartenenze

**Ambito:** gestione dell'appartenenza di un ragazzo ESISTENTE (trasferimento
comunità↔comunità, ↔After Us) + storico append-only + audit atomico. Nessun
nuovo utente/account/PIN, nessuna modifica a foto/operatori/PPU/Storage.

### Modello

- Identità = `utenti/{uid}` — **UID invariato**, documento mai ricreato.
- `utenti.comunitaId` = comunità corrente. After Us = `comunitaId === 'after-us'`.
- Destinazioni lette dalla collezione **`comunita`** (nessun hardcoding). Se
  `comunita/after-us` non esiste, il trasferimento verso After Us è **bloccato**
  con messaggio esplicito (nessun documento inventato).

### Schema appartenenze — `utenti/{uid}/appartenenze/{autoId}`

| campo | tipo | note |
|---|---|---|
| `comunitaId` | string non vuota | comunità del periodo |
| `dal` | timestamp | `== request.time` alla creazione |
| `al` | timestamp \| null | `null` = aperto; una volta chiuso non si riapre |
| `causale` | string 1..500 | amministrativa (no dati sensibili) |
| `actorUid` | string | `== request.auth.uid` |
| `createdAt` | timestamp | `== request.time` alla creazione |
| `legacyBaseline` | bool (solo baseline) | `true` sui record baseline legacy |

**Vincoli CREATE (solo admin):** `actorUid == auth.uid`; `dal == createdAt == request.time`;
`comunitaId` stringa non vuota; `causale` stringa 1..500. Due sole forme di chiavi:
(a) record **aperto** `{comunitaId, dal, al, causale, actorUid, createdAt}` con `al == null`;
(b) **baseline legacy** = (a) + `legacyBaseline: true` e `al == request.time` (chiuso alla nascita).
Chiavi extra → DENY.

**Vincoli CLOSE = update ONE-WAY (solo admin):** unico campo modificato `al`;
`resource.data.al == null` (deve essere aperto); `request.resource.data.al == request.time`
(niente timestamp arbitrari); tutti gli altri campi immutabili. ⇒ record già chiuso
non aggiornabile; `al:null` per riaprire fallisce.

**DELETE:** vietato a chiunque. **READ:** solo admin (NON allargato in D).

### Strategia utenti legacy senza storico

Molti ragazzi hanno `utenti.comunitaId` ma nessun record `appartenenze` (lo storico
non è mai stato popolato). Nessuna migrazione massiva. Al **primo trasferimento**:

1. si crea un record **baseline CHIUSO** per la comunità precedente:
   `comunitaId = <precedente>`, `legacyBaseline: true`, `dal == al == request.time`
   (⇒ **durata nulla**), `causale` esplicita («baseline legacy … data d'ingresso non
   nota»). **La data d'ingresso reale NON è nota e NON viene inventata**: il record
   registra soltanto che il ragazzo *era* in quella comunità prima dell'introduzione
   dello storico. Il flag `legacyBaseline` + durata nulla + causale lo rendono
   inequivocabile (non è un periodo reale).
2. si apre il nuovo record per la destinazione.

Se il ragazzo legacy non ha nemmeno `utenti.comunitaId` (nessuna comunità
precedente), non si crea baseline: si apre solo il nuovo record.

Dal secondo trasferimento in poi c'è sempre un record aperto → si chiude quello
e se ne apre uno nuovo (nessun baseline).

### Funzione dedicata `transferUtente(uid, destinazioneId, causale)`

`js/console/console-transfer.js`. NON esiste `updateUtente(uid, data)` generico.
Passi: valida input → verifica `comunita/{destinazioneId}` esiste (blocco After Us
se manca) → verifica `utenti/{uid}` esiste → rifiuta destinazione == corrente →
query appartenenze aperte (rifiuta se >1) → **transazione**.

### Transazione (atomicità + concorrenza)

`runTransaction`: rilegge `utenti/{uid}.comunitaId` (deve essere == valore pre-letto)
e l'eventuale appartenenza aperta (deve essere ancora `al == null`); poi
chiude/baseline + apre nuovo + `utenti.comunitaId` + `admin_audit`. Se una parte
è negata dalle Rules → **l'intera transazione è respinta, nessuna scrittura resta**
(verificato: staff non-admin / actorUid falsificato → `utenti.comunitaId` invariato).

**Concorrenza:** due admin che trasferiscono lo stesso ragazzo → la ri-lettura in
transazione fa fallire il secondo (nessun doppio record aperto, nessuna doppia
chiusura, `comunitaId` coerente). **Limite dichiarato:** le Firestore Rules da sole
**non possono** garantire "al più un'appartenenza aperta" (non contano/non
interrogano documenti fratelli). La garanzia viene dalla transazione lato
applicazione (ri-lettura), non dalle Rules. Le Rules garantiscono forma del
create + chiusura one-way + no delete.

### `utenti_pin.comunitaId` — NON sincronizzato (scelta documentata)

Ricognizione del codebase: `utenti_pin.comunitaId` è scritto **solo** alla
creazione del ragazzo (`js/ragazzi-pin.js:creaRagazzo`) e **non è letto da nessuna
parte** — né dal login PIN (`loginConPin` usa `utenti_pin_lookup` + `utenti.stato`),
né dalla Cloud Function `pinLogin.js` (legge `utenti_pin_lookup`, scrive solo
`lastLogin`), né da `gestione-ragazzi.html` / Console (usano `utenti.comunitaId`).
È dato **write-only ridondante**. Il trasferimento quindi **non lo tocca**: lasciarlo
stale non ha effetti funzionali. Se una milestone futura rendesse `utenti_pin`
autoritativo per qualcosa, `transferUtente` andrà esteso per includerlo nella
stessa transazione.

### Storage / PPU

- **Storage:** nessun file spostato/copiato/rinominato/cancellato. I documenti
  restano sotto `documenti/{comunitaOriginaria}/{uid}/…` (contesto storico).
- **PPU:** `ppu_schede_a/b.comunitaId` **immutabile**, invariato. Dopo il
  trasferimento: l'admin continua a vedere tutto; la scheda storica resta associata
  alla comunità in cui fu creata. Un eventuale accesso storico per la comunità
  attuale è **una milestone separata** (non affrontato qui).

### Audit

`admin_audit/{autoId}` con `action: 'USER_COMMUNITY_TRANSFER'`, `targetType: 'utente'`,
`targetId: uid`, `before: {comunitaId}`, `after: {comunitaId}`, `causale` (campo extra,
ammesso: la regola usa `hasAll`, non `hasOnly`). Vincoli invariati dalla Milestone C
(`actorUid == auth.uid`, `ts == request.time`, append-only).

---

## MILESTONE E — creazione ragazzo · After Us · PIN · foto

> **IMPLEMENTAZIONE LOCALE COMPLETA — ATTIVAZIONE IN PRODUZIONE ANCORA BLOCCATA da B2/B3.**
> Tutto verde in emulatore; il nuovo flusso NON è attivo in produzione finché non si esegue:
> **B2** `firebase deploy --only functions` · **B3** IAM `roles/iam.serviceAccountTokenCreator`
> sulla SA runtime delle Functions (serve solo a `createCustomToken` di `loginRagazzoConPin`
> in produzione; NON a `creaRagazzoAdmin`; NON in emulatore). B4 (migrazione PIN legacy)
> resta rimandata. *Il nuovo login NON è dichiarato attivo in produzione.*

### `creaRagazzoAdmin` (callable — `functions/creaRagazzoAdmin.js`)

Verifica `request.auth` + admin canonico (legacy UID OR `staff/{uid}.admin===true`, Admin SDK).
Valida `nome` (≤200), `comunitaId` (deve esistere in `comunita`; After Us non è speciale
oltre a questo), `pin` (`/^\d{4,6}$/`), `causale` (1..500).

**Auth**: UID generato server-side (`r_` + 14 byte hex). Email sintetica **deterministica
e univoca** (`slug(nome).<uid-10>.ragazzo@campodeifiori.org` — il segmento UID esclude
collisioni). **Password**: `crypto.randomBytes(32)` — usata SOLO per `createUser`,
**mai restituita, mai salvata (né `utenti` né `utenti_pin`), mai in audit, mai loggata**.
Il ragazzo non la conosce, l'admin nemmeno: login PIN → callable → custom token.

**Unicità PIN — riserva deterministica**: transazione Admin SDK che verifica
contemporaneamente `pin_reservations/{pin}` **+** query `utenti_pin where pin==` **+**
`utenti_pin_lookup/{pin}` (legacy) e, se libero, crea `pin_reservations/{pin} = {uid, createdAt}`
(doc-id = PIN, permanente). `Transaction.get(Query)` è supportato dall'Admin SDK → due
creazioni simultanee con lo stesso PIN: una sola riesce, l'altra `already-exists` (verificato).

**Ordine + compensazione** (Auth e Firestore non atomici):
1. transazione riserva PIN → se occupato: `already-exists` (nessun Auth, niente da pulire);
2. `createUser({uid,email,password})` → se fallisce: **rilascia la reservation** (solo se
   `.uid === uid`, ownership-checked) e termina;
3. batch Firestore: `utenti/{uid}` + `utenti_pin/{uid}` (**niente password, niente
   `utenti_pin_lookup`**) + `utenti/{uid}/appartenenze/{autoId}` (APERTA, `al:null`,
   **niente `legacyBaseline`**) + `admin_audit` (`action:'USER_CREATED'`, `before:{}`,
   `after:{comunitaId,stato}`, **niente pin/password**). Se il batch fallisce:
   `deleteUser(uid)` **+** rilascia reservation; se anche la compensazione fallisce →
   errore amministrativo esplicito che nomina l'orfano `uid`.

**Limite compensazione**: se la rete cade dopo `createUser` e prima che la compensazione
completi, può restare un orfano; l'errore lo dichiara e nomina l'`uid`.

Ritorna `{ uid, comunitaId, stato }` — **niente pin, niente password**.

### PIN — modello e recuperabilità (transitoria)

| | NUOVI (`creaRagazzoAdmin`) | LEGACY (`js/ragazzi-pin.js:creaRagazzo`) |
|---|---|---|
| `utenti_pin/{uid}.pin` | ✅ chiaro, **admin-only** (transitorio: futura UX mostra/copia/cambia PIN) | ✅ |
| `utenti_pin_lookup/{pin}` | ❌ **non creato** | ✅ (serve al fallback login legacy fino a B4) |
| `pin_reservations/{pin}` | ✅ privato (`allow read,write: if false`) | ❌ |
| password Firebase | random, non persistita | `"CF"+pin` (derivabile) |
| login | callable-only (custom token) | callable (via query `utenti_pin`) **o** fallback legacy |

### `loginRagazzoConPin` — modifiche (`functions/pinLogin.js`)

Risoluzione PIN → UID: (1) query `utenti_pin where pin==input`; (2) fallback transitorio
`utenti_pin_lookup/{pin}`. Il **client non interroga più `utenti_pin_lookup`**. Invariati:
rate limit per IP, verifica `stato:'archiviato'`, custom token. **Errore uniforme**: PIN
inesistente **e** ragazzo archiviato → **stesso** codice `permission-denied` e messaggio
`"PIN non valido."` (prima `not-found`; cambiato per non collidere con il `functions/not-found`
di "callable non deployata").

### Login client callable-first — `js/pin-login.js` (usato da `login.html`)

`loginRagazzoPin(pin)`: `httpsCallable('loginRagazzoConPin')` → `signInWithCustomToken`.
**Policy di fallback al percorso legacy (`loginConPin`) — ESATTA:**
- **Fallback SÌ** solo per condizioni tecniche di rollout: `error.code` ∈
  `{functions/not-found, functions/unavailable, functions/unimplemented}` **oppure** un
  errore con `code` che NON inizia per `functions/` (trasporto: rete/CORS/DNS).
- **Fallback NO** — verdetti applicativi (preservano rate-limit e uniformità):
  `functions/permission-denied` → "PIN non valido."; `functions/resource-exhausted` →
  "Troppi tentativi…"; `functions/invalid-argument` → "PIN non valido.".
- **Fallback NO** — errori tecnici non di rollout (`functions/internal`,
  `functions/deadline-exceeded`, `functions/cancelled`, `functions/aborted`, …) →
  "Accesso non riuscito. Riprova." (nessun bypass del rate limit).

Motivo: senza questa distinzione un aggressore forzerebbe un errore per far scattare
il fallback legacy e bypassare il rate limiting.

### After Us / appartenenza iniziale / foto

- After Us = destinazione come le altre; selezionabile solo se `comunita/after-us` esiste.
  Creazione diretta in After Us = stessa callable con `comunitaId:'after-us'`.
- Appartenenza iniziale **APERTA** (`al:null`, `causale` dall'admin, default "Prima
  assegnazione"), **nessun** `legacyBaseline`.
- Foto **opzionale**, gestita DOPO la creazione: validazione client `image/*` + ≤ 5 MB +
  preview; upload Cloudinary (preset unsigned — **limite noto**: la validazione client non
  lo rende sicuro); poi `updateDoc(utenti/{uid}, { fotoProfilo })` (solo quel campo). Se
  l'upload fallisce → ragazzo **creato correttamente** + "Foto non caricata", nessun
  rollback dell'identità.

### Security Rules

- **NUOVA** `match /pin_reservations/{pin} { allow read, write: if false; }` — nessun
  client (admin incluso); solo Admin SDK.
- `utenti` / `utenti_pin` / `utenti_pin_lookup`: **rules invariate**. La creazione passa
  da Admin SDK (bypassa le Rules); le aperture client legacy restano come **debito legacy**
  (servono ancora a `js/ragazzi-pin.js:creaRagazzo` e al fallback login). Da restringere
  nella milestone di migrazione B4, non ora.

### Test (emulatore firestore+auth+storage+**functions**, JDK 21)

- Rules **135** (114 Milestone D + **21** `pin-reservations.test.mjs`).
- Storage **24** (invariati).
- **Functions/Auth** (`test/functions/`, client SDK + Admin SDK, `--test-concurrency=1`)
  **24**: autorizzazione · validazione · unicità PIN (utenti_pin / utenti_pin_lookup /
  pin_reservations) · SUCCESS STATE (account + documenti + appartenenza + audit, **nessun
  segreto** in risposta/Firestore/audit) · compensazione (reservation collision → nessun
  Auth; Firestore-fallisce-dopo-Auth → `deleteUser` + reservation rilasciata + niente
  `utenti`/audit) · concorrenza PIN · login PIN (nuovo modello, compat legacy via lookup,
  errori uniformi, formato, nessun PIN nel messaggio, rate limiting).
- **Totale 135 + 24 + 24 = 183, tutti verdi** (3 run consecutivi).

### Fault injection prod-inerte

`creaRagazzoAdmin` onora `request.data.__testFailAfterAuth === true` **solo** se
`GCLOUD_PROJECT` inizia con `demo-` (emulatore). In produzione (`campo-dei-fiori`)
è ignorato. Serve al solo test di compensazione.

### Azioni ancora necessarie per la produzione

1. **B2** `firebase deploy --only functions`. Dopo: `creaRagazzoAdmin` pienamente
   funzionale in produzione.
2. **B3** grant IAM `roles/iam.serviceAccountTokenCreator` sulla SA runtime
   (`campo-dei-fiori@appspot.gserviceaccount.com` Gen1, o la SA della funzione Gen2).
   Senza B3 la callable `loginRagazzoConPin` fallisce a runtime su `createCustomToken`;
   il client cade sul fallback legacy (che copre i ragazzi legacy, **non** i nuovi).
3. **B4** migrazione PIN legacy → eliminazione `utenti_pin_lookup` pubblico (milestone dedicata).

---

## Patch E.1 — Hardening recovery pre-produzione (commit `fix(console): harden pin creation recovery`)

Nessun deploy, nessun IAM, nessuna azione su Firebase reale. Solo `functions/` + test.

### Formato PIN — verifica

Formato **canonico reale = 4–6 cifre** (generatore a 6). Evidenze: `js/ragazzi-pin.js`
(`generaPin` → `100000..999999`; `cambiaPinRagazzo` `/^\d{4,6}$/`), `login.html`
(`maxlength="6"`, `/^\d{4,6}$/`), `gestione-ragazzi.html` (`maxlength="6"`),
`robinson/login.html` (`MIN_PIN=4`, `MAX_PIN=6`), `robinson/admin-pin.html` (`/^\d{4,6}$/`).
→ `/^\d{4,6}$/` **confermato invariato** in `creaRagazzoAdmin`, `pinLogin`, client. `0000`
è formalmente valido (nessun divieto legacy) e mai auto-generato. Restringere a 4 cifre
richiederebbe una decisione esplicita e toccherebbe il legacy: **non fatto**.

### `pin_reservations/{pin}` — lifecycle RESERVED → ACTIVE

Forma: `{ uid, status, createdAt, activatedAt? }`. `RESERVED` alla prenotazione (transazione);
`ACTIVE` scritto **nello stesso `batch` Firestore** che crea profilo+utenti_pin+appartenenza+audit
→ transizione atomica col profilo. `allow read, write: if false` per ogni client, invariato.
`releaseReservation` (compensazione) ora rifiuta di cancellare se `status === 'ACTIVE'` **o**
se `uid` non combacia.

### Riconciliazione fuori banda — `functions/pinReconcile.js` (NON callable)

Helper server-side a dependency injection `{db, auth}`, da invocare manualmente. La
compensazione `catch` copre solo gli errori gestiti; un kill del processo fra `createUser`
e il `batch` non fa scattare alcun `catch` → serve questa riconciliazione.

- `classifyPinState(deps, pin)` — sola lettura. Stati:
  `NOT_FOUND` · `HEALTHY` (ACTIVE + Auth + utenti + utenti_pin coerenti) ·
  `ORPHAN_RESERVATION` (RESERVED, no Auth, no utenti → recuperabile) ·
  `INCOMPLETE_AUTH` (RESERVED + Auth, no utenti) ·
  `RESERVED_STALE` (RESERVED ma Auth+utenti presenti → revisione manuale) ·
  `INCONSISTENT_ACTIVE` (ACTIVE ma stato rotto) · `INCONSISTENT` ·
  `LEGACY` (no reservation, `utenti_pin` + `utenti_pin_lookup`) ·
  `INCONSISTENT_NO_RESERVATION` (no reservation, `utenti_pin` senza lookup —
  **limite dichiarato**: non distinguibile con certezza da legacy con lookup cancellato;
  nessuna euristica applicata).
- `reconcileAll(deps, {limit})` — diagnosi aggregata `{scanned, byState, items}`, sola lettura.
- `cleanupOrphanReservation(deps, pin, expectedUid)` — cancella **una** reservation e
  **solo** se: `expectedUid` presente **e** `reservation.uid === expectedUid` **e**
  `status !== 'ACTIVE'` **e** stato classificato `ORPHAN_RESERVATION`. Non tocca **mai**
  Auth né `utenti`. Esiti: `DELETED | DENIED | SKIPPED | NOOP`.

### Email sintetica

Era `${slug(nome)}.${uid.slice(-10)}.ragazzo@…` (dipendeva dal nome). Ora
**`${uid}.ragazzo@campodeifiori.org`**: deterministica dall'UID, indipendente dal nome,
senza PIN, senza collisioni (UID = 14 byte random). `slug()` rimosso.

### Login e reservation

`loginRagazzoConPin` **non** consulta `pin_reservations`: fonte credenziale = `utenti_pin`
(poi fallback `utenti_pin_lookup`). Una reservation incoerente da sola **non autentica**
(test dedicato: `pin_reservations` RESERVED senza `utenti_pin`/`utenti` → `permission-denied`).

### PIN nei log — scansione statica

`creaRagazzoAdmin.js`, `pinLogin.js`, `pinReconcile.js`, `js/pin-login.js`,
`js/console/console-crea-ragazzo.js`: **nessun** `console.*`/`logger.*`, nessun
`JSON.stringify` dell'input, nessun valore di PIN in messaggi `HttpsError`, audit o
risposta callable. (`functions/index.js` ha `console.log` preesistenti FCM/Benvenuto, fuori
scope, senza PIN.)

### Test — Patch E.1

- Rules **135** (invariati) · Storage **24** (invariati).
- **Functions/Auth 41** (era 24): + `pin-reconcile.test.mjs` (**14**: stati di crash,
  ownership/`ACTIVE`/non-orfano → nessuna cancellazione, orfana vera → `DELETED` con
  Auth/utenti intatti, `LEGACY` vs `INCONSISTENT_NO_RESERVATION`, `reconcileAll`) ·
  + `crea-ragazzo`: reservation finale `ACTIVE`, email deterministica dall'UID senza
  nome/PIN, PIN validi `0000`/`1234`/`12345`/`123456` accettati, `already-exists` senza
  PIN nel messaggio · + `pin-login`: sola reservation non autentica.
- **Totale 135 + 24 + 41 = 200, tutti verdi (3 run consecutivi).**
