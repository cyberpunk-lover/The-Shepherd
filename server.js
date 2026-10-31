// The Shepherd, server locale: mostra il sito esattamente come su GitHub Pages
// ("/" giocatori, "/master" master) e rigenera da solo i file cifrati in cifrato/
// quando cambiano gli appunti o i dati in dati-mappa/.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { RADICE, CARTELLA_DATI, CARTELLA_IMMAGINI } from './lib/grafo.js';
import { CARTELLA_CAMPAGNA } from './lib/contenuti.js';
import { costruisci, CARTELLA_CIFRATO } from './lib/costruisci.js';

const PORTA = Number(process.env.PORT) || 4077;
const HOST = process.env.HOST || '127.0.0.1';
const PUBBLICA = path.join(RADICE, 'public');
const ascoltatori = new Set();

// ---------- file cifrati sempre aggiornati ----------

let inCostruzione = Promise.resolve();
let attesaCostruzione = null;

function ricostruisci() {
  clearTimeout(attesaCostruzione);
  attesaCostruzione = setTimeout(() => {
    inCostruzione = inCostruzione
      .then(costruisci)
      .then(({ blocchi, immagini }) => {
        console.log(`cifrato/ aggiornato: ${blocchi} blocchi, ${immagini} immagini.`);
        for (const res of ascoltatori) res.write('data: aggiornato\n\n');
      })
      .catch((e) => console.error('Errore nel generare i file cifrati:', e.message));
  }, 200);
}

watch(CARTELLA_CAMPAGNA, (_, file) => file?.endsWith('.md') && ricostruisci());
watch(CARTELLA_DATI, (_, file) => ['grafo.json', 'disegni.js'].includes(file) && ricostruisci());
watch(CARTELLA_IMMAGINI, () => ricostruisci());

// ---------- http ----------

const TIPI = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.bin': 'application/octet-stream',
};

async function servi(res, file) {
  try {
    const contenuto = await readFile(file);
    res.writeHead(200, { 'Content-Type': TIPI[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(contenuto);
  } catch {
    res.writeHead(404).end('Non trovato');
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET') return res.writeHead(405).end();

  if (pathname === '/') return servi(res, path.join(PUBBLICA, 'index.html'));
  if (pathname === '/master') return servi(res, path.join(PUBBLICA, 'master.html'));

  // I file cifrati: esattamente quelli che vanno su GitHub Pages.
  if (pathname === '/blocchi.json' || pathname === '/master.json' || /^\/i\/[0-9a-f]+\.bin$/.test(pathname)) {
    await inCostruzione;
    return servi(res, path.join(CARTELLA_CIFRATO, pathname.slice(1)));
  }

  if (pathname === '/api/eventi') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    ascoltatori.add(res);
    req.on('close', () => ascoltatori.delete(res));
    return;
  }

  // Le pagine: solo i file dentro public/, con nome semplice.
  if (/^\/[\w-]+\.(html|css|js|svg)$/.test(pathname)) return servi(res, path.join(PUBBLICA, pathname.slice(1)));

  res.writeHead(404).end('Non trovato');
});

setInterval(() => {
  for (const res of ascoltatori) res.write(': ping\n\n');
}, 25_000);

ricostruisci();
server.listen(PORTA, HOST, () => {
  const base = `http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORTA}`;
  console.log(`The Shepherd · giocatori: ${base}/`);
  console.log(`The Shepherd · master:    ${base}/master`);
});
