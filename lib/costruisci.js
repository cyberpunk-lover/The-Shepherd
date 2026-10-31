// Cifra i blocchi della mappa in cifrato/ (blocchi.json e immagini in i/). È l'unica parte del sito
// che dipende dai dati segreti: si genera in locale e si committa, la GitHub Action la pubblica.
// Ogni blocco è cifrato (AES-GCM) con una chiave ricavata dal suo codice: senza il codice è illeggibile.
// Anche i nomi dei blocchi sono resi anonimi. La pagina del master è un unico file cifrato con la sua password.
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { pbkdf2Sync, randomBytes, createCipheriv, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { RADICE, CARTELLA_DATI, caricaGrafo, archiCompleti, normalizza, leggiJson, scriviJson } from './grafo.js';

export const CARTELLA_CIFRATO = path.join(RADICE, 'cifrato');
const FILE_SEGRETI = path.join(CARTELLA_DATI, 'segreti.json');
const ITERAZIONI = 20_000;
// La password del master è più corta di un codice: ogni tentativo deve costare molto di più.
const ITERAZIONI_MASTER = 600_000;

// Sale e chiave per gli id restano uguali tra una generazione e l'altra,
// così i file cifrati non cambiano se non cambiano i contenuti.
async function segreti() {
  let s = {};
  try {
    s = await leggiJson(FILE_SEGRETI);
  } catch {}
  const mancanti = ['sale', 'chiaveId', 'saleMaster'].filter((k) => !s[k]);
  if (!mancanti.length) return s;
  for (const k of mancanti) s[k] = randomBytes(k === 'chiaveId' ? 32 : 16).toString('base64');
  await scriviJson(FILE_SEGRETI, s);
  return s;
}

// Stessa derivazione di public/cifra.js: i primi 32 byte sono la chiave, gli altri 16 l'etichetta del blocco.
function deriva(segreto, sale, iterazioni = ITERAZIONI) {
  const bit = pbkdf2Sync(segreto, sale, iterazioni, 48, 'sha256');
  return { chiave: bit.subarray(0, 32), etichetta: bit.subarray(32, 48).toString('hex') };
}

// IV ricavato dal contenuto: stesso contenuto, stesso file cifrato (niente modifiche inutili su git).
function cifra(chiave, dati) {
  const iv = createHmac('sha256', chiave).update(dati).digest().subarray(0, 12);
  const c = createCipheriv('aes-256-gcm', chiave, iv);
  return Buffer.concat([iv, c.update(dati), c.final(), c.getAuthTag()]);
}

export async function costruisci() {
  const { zone, nodi } = await caricaGrafo({ conFonti: true });
  const { sale, chiaveId, saleMaster } = await segreti();
  const saleBuf = Buffer.from(sale, 'base64');
  const perId = new Map(nodi.map((n) => [n.id, n]));
  const opaco = (id) => createHmac('sha256', Buffer.from(chiaveId, 'base64')).update(id).digest('hex').slice(0, 12);
  // Quello che un blocco rivela degli altri: dove stanno e, per le piste, come appaiono da "?".
  const rif = (id, conRumor) => {
    const n = perId.get(id);
    return { id: opaco(id), x: n.x, y: n.y, grande: n.grande, ...(conRumor && { rumor: n.rumor }) };
  };

  await rm(CARTELLA_CIFRATO, { recursive: true, force: true });
  await mkdir(path.join(CARTELLA_CIFRATO, 'i'), { recursive: true });

  const blocchi = {};
  for (const n of nodi) {
    const { chiave, etichetta } = deriva(normalizza(n.codice), saleBuf);
    let immagine = null;
    if (n.immagine) {
      immagine = { file: `i/${opaco(n.id)}.bin`, tipo: n.immagine.tipo };
      await writeFile(path.join(CARTELLA_CIFRATO, immagine.file), cifra(chiave, await readFile(n.immagine.file)));
    }
    const contenuto = {
      id: opaco(n.id),
      tipo: n.tipo,
      grande: n.grande,
      zona: n.zona && { nome: n.zona.nome, colore: n.zona.colore },
      x: n.x,
      y: n.y,
      titolo: n.titolo,
      sottotitolo: n.sottotitolo,
      html: n.html,
      disegnoSvg: n.disegnoSvg,
      voce: n.voce,
      frammento: n.frammento,
      rumor: n.rumor,
      immagine,
      padre: n.padre && rif(n.padre, true),
      figli: n.figli.map(opaco),
      legami: [...n.porta.map((t) => ({ ...rif(t, true), porta: true })), ...n.collega.map((t) => rif(t, false))],
    };
    blocchi[etichetta] = cifra(chiave, Buffer.from(JSON.stringify(contenuto))).toString('base64');
  }

  // In ordine di etichetta, che è casuale: l'ordine non dice niente sulla mappa.
  const ordinati = Object.fromEntries(Object.entries(blocchi).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(path.join(CARTELLA_CIFRATO, 'blocchi.json'), JSON.stringify({ sale, iterazioni: ITERAZIONI, blocchi: ordinati }) + '\n');

  // La pagina del master: tutta la mappa, note e codici, in un solo file cifrato con la password.
  const password = process.env.MASTER_PASSWORD;
  if (password) {
    const { chiave } = deriva(password, Buffer.from(saleMaster, 'base64'), ITERAZIONI_MASTER);
    const master = {
      zone,
      archi: archiCompleti(nodi),
      nodi: nodi.map(({ porta, collega, immagine, ...n }) => ({
        ...n,
        // Le immagini sono già in i/, cifrate col codice del blocco: il master le apre con quello.
        immagine: immagine ? { file: `i/${opaco(n.id)}.bin`, tipo: immagine.tipo } : null,
      })),
    };
    const dati = cifra(chiave, Buffer.from(JSON.stringify(master))).toString('base64');
    await writeFile(path.join(CARTELLA_CIFRATO, 'master.json'), JSON.stringify({ sale: saleMaster, iterazioni: ITERAZIONI_MASTER, dati }) + '\n');
  } else {
    console.warn('MASTER_PASSWORD non impostata: la pagina del master non viene generata.');
  }
  return { blocchi: nodi.length, immagini: nodi.filter((n) => n.immagine).length, master: !!password };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { blocchi, immagini } = await costruisci();
  console.log(`cifrato/ aggiornato: ${blocchi} blocchi, ${immagini} immagini. Fai commit e push per pubblicare.`);
}
