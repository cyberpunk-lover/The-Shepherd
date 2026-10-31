// Tutto quello che serve sia alla pagina master sia al sito cifrato:
// il grafo, le posizioni sulla mappa, i testi dei blocchi e i codici.
// I dati con gli spoiler (grafo, codici, disegni, immagini) stanno fuori dal repository,
// in dati-mappa/ nella cartella della campagna: qui arrivano solo cifrati.
import { readFile, writeFile, rename, readdir, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { CARTELLA_CAMPAGNA, leggiAppunto, html, sezione, testoGiocatori, citazioniDopo, parseVoci } from './contenuti.js';

export const RADICE = path.resolve(import.meta.dirname, '..');
export const CARTELLA_DATI = path.join(CARTELLA_CAMPAGNA, 'dati-mappa');
const FILE_GRAFO = path.join(CARTELLA_DATI, 'grafo.json');
const FILE_CODICI = path.join(CARTELLA_DATI, 'codici.json');
const FILE_DISEGNI = path.join(CARTELLA_DATI, 'disegni.js');
export const CARTELLA_IMMAGINI = path.join(CARTELLA_DATI, 'immagini');
const ESTENSIONI_IMMAGINE = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.avif': 'image/avif' };

export async function leggiJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function scriviJson(file, dati) {
  const temporaneo = `${file}.tmp`;
  await writeFile(temporaneo, JSON.stringify(dati, null, 2) + '\n');
  await rename(temporaneo, file);
}

export const normalizza = (codice) => String(codice ?? '').toUpperCase().replace(/[^0-9A-F]/g, '');
const nuovoCodice = () => randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g).join('-');

// Ogni blocco ha un codice, che non cambia più una volta creato: quelli che mancano vengono generati ora.
async function assicuraCodici(grafo) {
  let codici = {};
  try {
    codici = await leggiJson(FILE_CODICI);
  } catch {}
  const usati = new Set(Object.values(codici).map(normalizza));
  let nuovi = false;
  for (const n of grafo.nodi) {
    if (codici[n.id]) continue;
    let codice;
    do codice = nuovoCodice();
    while (usati.has(normalizza(codice)));
    usati.add(normalizza(codice));
    codici[n.id] = codice;
    nuovi = true;
  }
  if (nuovi) await scriviJson(FILE_CODICI, codici);
  return codici;
}

// I luoghi hanno posizioni scritte a mano, i loro blocchi stanno in cerchio attorno.
function posizioni(grafo) {
  const pos = new Map();
  for (const luogo of grafo.nodi.filter((n) => !n.padre)) {
    pos.set(luogo.id, { x: luogo.x, y: luogo.y });
    const figli = grafo.nodi.filter((n) => n.padre === luogo.id);
    const raggio = luogo.raggio ?? Math.max(195, (figli.length * 150) / (2 * Math.PI));
    const inizio = ((luogo.angolo ?? -90) * Math.PI) / 180;
    figli.forEach((f, i) => {
      const a = inizio + (i * 2 * Math.PI) / figli.length;
      pos.set(f.id, f.x != null ? { x: f.x, y: f.y } : { x: Math.round(luogo.x + raggio * Math.cos(a)), y: Math.round(luogo.y + raggio * Math.sin(a)) });
    });
  }
  return pos;
}

// I disegnini degli appunti: ricaricati quando il file cambia.
async function disegni() {
  try {
    const { mtimeMs } = await stat(FILE_DISEGNI);
    return (await import(`${pathToFileURL(FILE_DISEGNI).href}?v=${mtimeMs}`)).DISEGNI;
  } catch {
    return {};
  }
}

async function immagini() {
  const trovate = new Map();
  try {
    for (const file of await readdir(CARTELLA_IMMAGINI)) {
      const tipo = ESTENSIONI_IMMAGINE[path.extname(file).toLowerCase()];
      if (tipo) trovate.set(path.basename(file, path.extname(file)), { file: path.join(CARTELLA_IMMAGINI, file), tipo });
    }
  } catch {}
  return trovate;
}

// Il grafo completo, con testi già pronti in HTML. Ogni nodo:
// { id, tipo, grande, zona, padre, figli, x, y, titolo, sottotitolo, html, disegnoSvg, voce, frammento,
//   rumor, porta, collega, immagine, codice, master, fonti }
export async function caricaGrafo({ conFonti = false } = {}) {
  const grafo = await leggiJson(FILE_GRAFO);
  const codici = await assicuraCodici(grafo);
  // Le bozze ("bozza": true) restano nel file ma non finiscono né sulla mappa né nel sito.
  grafo.nodi = grafo.nodi.filter((n) => !n.bozza);
  const voci = new Map(parseVoci(await leggiAppunto('Voci Diario.md')).map((v) => [v.numero, v]));
  const foto = await immagini();
  const schizzi = await disegni();
  const pos = posizioni(grafo);
  const perId = new Map(grafo.nodi.map((n) => [n.id, n]));
  const zone = new Map(grafo.zone.map((z) => [z.id, z]));
  const letti = new Map();
  const leggi = (file) => {
    if (!letti.has(file)) letti.set(file, leggiAppunto(file));
    return letti.get(file);
  };

  const nodi = [];
  for (const n of grafo.nodi) {
    let titolo = n.titolo;
    let sottotitolo = '';
    let md = n.testo ?? '';
    if (n.fonte) md = citazioniDopo(await leggi(n.fonte.file), n.fonte.dopo) ?? `*(testo non trovato in ${n.fonte.file})*`;
    if (n.tipo === 'voce') {
      const v = voci.get(n.voce);
      titolo = `Voce ${n.voce}`;
      sottotitolo = v ? [v.data, v.eta != null && `età ${v.eta}`].filter(Boolean).join(' · ') : '';
      md = v?.testo ?? '*(voce non trovata in Voci Diario.md)*';
    } else if (n.tipo === 'luogo') {
      md = n.descrizioneTesto ?? '';
      if (!md && n.descrizione) {
        const sez = sezione(await leggi(n.descrizione.file), n.descrizione.sezione);
        md = (sez && testoGiocatori(sez)) ?? '';
      }
    }

    const fonti = [];
    if (conFonti) {
      for (const fonte of n.fontiMaster ?? []) {
        const testo = fonte.sezione ? sezione(await leggi(fonte.file), fonte.sezione) : await leggi(fonte.file);
        fonti.push({
          etichetta: [fonte.file.replace(/\.md$/, ''), fonte.sezione].filter(Boolean).join(' · '),
          html: testo ? html(testo) : `<p><em>Sezione «${fonte.sezione}» non trovata in ${fonte.file}.</em></p>`,
        });
      }
    }

    nodi.push({
      id: n.id,
      tipo: n.tipo,
      grande: n.tipo === 'luogo',
      zona: zone.get(n.zona ?? perId.get(n.padre)?.zona) ?? null,
      padre: n.padre ?? null,
      figli: grafo.nodi.filter((f) => f.padre === n.id).map((f) => f.id),
      ...pos.get(n.id),
      titolo,
      sottotitolo,
      html: html(md),
      disegnoSvg: n.disegno ? `<svg viewBox="0 0 120 80">${schizzi[n.disegno] ?? ''}</svg>` : null,
      voce: n.tipo === 'voce' ? n.voce : null,
      frammento: n.frammento ?? null,
      // Come appare quando è ancora un "?": solo i luoghi hanno un testo apposta.
      rumor: n.tipo === 'luogo' && n.voce ? n.voce : { titolo: '?', testo: '' },
      // Solo legami verso blocchi pubblicati, ognuno con il suo perché.
      porta: (n.porta ?? []).filter((t) => perId.has(t)),
      collega: (n.collega ?? []).filter((t) => perId.has(t)),
      perche: n.perche ?? {},
      immagine: foto.get(n.id) ?? null,
      codice: codici[n.id],
      master: html([n.master, n.noteMaster].filter(Boolean).join('\n\n')),
      fonti,
    });
  }
  return { zone: grafo.zone, nodi };
}

// Tutte le linee della mappa: luogo → blocco ("contiene") e piste nel loro verso ("porta" o "spiega").
export function archiCompleti(nodi) {
  const archi = [];
  for (const n of nodi) {
    if (n.padre) archi.push({ da: n.padre, a: n.id, tipo: 'contiene' });
    for (const t of n.porta) archi.push({ da: n.id, a: t, tipo: 'pista', porta: true, perche: n.perche[t] ?? null });
    for (const t of n.collega) archi.push({ da: n.id, a: t, tipo: 'pista', porta: false, perche: n.perche[t] ?? null });
  }
  return archi;
}
