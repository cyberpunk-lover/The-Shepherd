# The Shepherd

Registro di bordo in stile Outer Wilds per una campagna di Cyberpunk. Ogni blocco della mappa (luogo, appunto, voce del diario, frammento) si sblocca con un codice esadecimale che il master dà ai giocatori. Il codice si inserisce sul proprio dispositivo e il blocco compare, insieme ai `?` verso i posti dove porta.

Sito: https://cyberpunk-lover.github.io/The-Shepherd/

## Come funziona

Il sito è statico. `cifrato/blocchi.json` contiene ogni blocco cifrato con AES-GCM, con una chiave ricavata dal suo codice (PBKDF2): senza il codice giusto non c'è niente da leggere. Anche le immagini in `cifrato/i/` sono cifrate e i nomi dei blocchi sono anonimi. Il browser decifra in locale e salva i codici inseriti.

La pagina del master (`master.html`) è statica allo stesso modo: `cifrato/master.json` contiene mappa completa, note e codici, cifrati con la password del master (PBKDF2 con 600.000 iterazioni).

In questo repository non ci sono né i contenuti in chiaro né i codici: stanno nella cartella della campagna, fuori da qui.

## Struttura

- `public/`: le pagine. `giocatori.js` e `master.js` decifrano nel browser con `cifra.js`, `mappa.js` disegna la mappa per entrambe.
- `lib/costruisci.js`: genera `cifrato/` a partire dai dati della campagna.
- `lib/assembla.js`: mette insieme `public/` e `cifrato/` nel sito finale. È quello che fa la GitHub Action.
- `server.js`: anteprima locale del sito, che rigenera `cifrato/` quando cambiano i dati.
- `.github/workflows/pagine.yml`: pubblica su GitHub Pages a ogni push su `main`.

## In locale

Il repository va clonato dentro la cartella della campagna, accanto a `dati-mappa/` e agli appunti `.md`. Per una posizione diversa si usa la variabile `SHEPHERD_CAMPAGNA`.

```bash
npm install
cp .env.example .env   # password con cui viene cifrata la pagina del master
npm start
```

- Giocatori: http://localhost:4077/ (online: https://cyberpunk-lover.github.io/The-Shepherd/)
- Master: http://localhost:4077/master (online: https://cyberpunk-lover.github.io/The-Shepherd/master.html)

Mentre il server è acceso, `cifrato/` si rigenera da solo quando cambiano gli appunti o i dati. Senza server si usa `npm run build`. Per pubblicare basta fare commit e push di `cifrato/`.
