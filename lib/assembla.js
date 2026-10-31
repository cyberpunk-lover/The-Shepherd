// Mette insieme il sito: le pagine di public/ più i file già cifrati di cifrato/ (blocchi e master).
// Non legge nessun dato segreto, quindi gira anche nella GitHub Action.
// Uso: node lib/assembla.js [cartella di uscita, predefinita _site]
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const RADICE = path.resolve(import.meta.dirname, '..');
const USCITA = path.resolve(RADICE, process.argv[2] ?? '_site');
const PAGINE = ['index.html', 'master.html', 'giocatori.js', 'master.js', 'mappa.js', 'cifra.js', 'stile.css', 'icona.svg'];

await rm(USCITA, { recursive: true, force: true });
await mkdir(USCITA, { recursive: true });
for (const file of PAGINE) await cp(path.join(RADICE, 'public', file), path.join(USCITA, file));
await cp(path.join(RADICE, 'cifrato'), USCITA, { recursive: true });
await writeFile(path.join(USCITA, '.nojekyll'), '');
console.log(`Sito pronto in ${path.relative(RADICE, USCITA)}/`);
