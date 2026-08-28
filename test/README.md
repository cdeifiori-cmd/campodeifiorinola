# Test Security Rules — Firebase Emulator (Milestone A, Console Admin)

Questi test verificano **esclusivamente** le Firestore Security Rules
(`../firestore.rules`) contro l'**emulatore locale**. Non toccano mai il
progetto reale `campo-dei-fiori` (vedi guardia anti-produzione in
`rules/helpers.mjs`).

## Prerequisiti

```bash
npm install          # installa @firebase/rules-unit-testing, firebase, firebase-tools (devDependencies)
```

È richiesta una JDK (Java 11+) perché l'emulatore Firestore gira su JVM.

## Esecuzione

```bash
npm run test:rules
```

Lo script equivale a:

```bash
firebase emulators:exec --only firestore,auth --project demo-campo-dei-fiori-test "node --test test/rules/"
```

`firebase emulators:exec`:
1. avvia gli emulatori Firestore (porta 8080) e Auth (porta 9099) — vedi `../firebase.json`;
2. imposta `FIRESTORE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST`;
3. esegue `node --test test/rules/` (runner nativo di Node ≥ 18);
4. spegne gli emulatori e propaga l'exit code.

## Guardia anti-produzione

`rules/helpers.mjs` fa **`process.exit(1)` immediato** se:

- `FIRESTORE_EMULATOR_HOST` non è impostato o non punta a un host locale;
- il `projectId` di test non inizia con `demo-` o coincide con `campo-dei-fiori`;
- è presente `GOOGLE_APPLICATION_CREDENTIALS`;
- `GCLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT` puntano al progetto reale.

Il `projectId` `demo-campo-dei-fiori-test` ha il prefisso `demo-`: l'emulatore
Firebase lo tratta come progetto fittizio e **rifiuta qualsiasi credenziale reale**.

## File

| File | Copre |
|---|---|
| `rules/helpers.mjs` | setup emulatore, guardia anti-produzione, seed identità |
| `rules/utenti.test.mjs` | fix R1/D1: `utenti/{uid}` campi di sistema non auto-modificabili; self-service ancora ok |
| `rules/staff-amici.test.mjs` | stessa protezione su `staff/{uid}` e `amici/{uid}` (decisione §18.3) |
| `rules/appartenenze.test.mjs` | `utenti/{uid}/appartenenze`: create solo admin, update solo campo `al`, delete vietato |
| `rules/admin-audit.test.mjs` | `admin_audit`: append-only assoluto (no update/delete nemmeno admin) |
| `rules/documenti-ppu.test.mjs` | nessuna regressione su `ppu_schede_a/b`; `isAdmin()` nuovo modello legge le PPU |
