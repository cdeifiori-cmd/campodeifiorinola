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

### Note / gap noti (da riprendere)

- `storage.rules` `isAdmin()` è ancora solo UID legacy: un admin "nuovo modello"
  (`staff.admin === true`) **non** è super-user in Storage e accede solo via
  ruolo/flag + scope. Stesso limite in `documenti.html` (`isAdmin = uid === ADMIN_UID`).
  Coerente con la decisione §18.3 ("non rimuovere ancora gli hardcoding"): da
  rivedere in una milestone dedicata.
- `documenti.html`: bug preesistente (fuori scope §13) — uno staff con
  `accessoDocumenti === true` ma senza ruolo coord/resp ottiene `canWrite` ma
  `myComunita` resta `[]` (nessuna comunità navigabile). Non introdotto da questa
  milestone; da correggere quando si toccherà la navigazione di `documenti.html`.
