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

// I luoghi hanno posizioni scritte a mano. Attorno a ogni luogo i suoi blocchi si aprono a ventaglio,
// come nel registro di Outer Wilds: gli appunti da una parte, le voci del diario dall'altra,
// a zig-zag su due distanze e con un piccolo scarto fisso per carta, così non sembra una griglia.
// Nel grafo si può cambiare lato con "appunti" e "voci": "destra", "sinistra", "sopra", "sotto" o un angolo in gradi.
const LATI = { destra: 0, sotto: 90, sinistra: 180, sopra: 270 };
const DISTACCO = 165; // distanza minima tra due carte della stessa fila
const DISTANZA_MIN = 260; // dal centro del luogo alla prima fila
const TRA_FILE = 135; // tra la prima e la seconda fila

// Uno scarto tra -1 e 1 sempre uguale per lo stesso blocco.
function scarto(id, sale) {
  let h = 2166136261;
  for (const c of `${id}:${sale}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) / 2 ** 32) * 2 - 1;
}

function posizioni(grafo) {
  const pos = new Map();
  // Ogni blocco con una posizione scritta a mano (i luoghi, ma anche un blocco che ne contiene altri)
  // fa da centro al suo ventaglio, anche se sta dentro un altro luogo.
  for (const luogo of grafo.nodi.filter((n) => n.x != null)) {
    pos.set(luogo.id, { x: luogo.x, y: luogo.y });
    const figli = grafo.nodi.filter((n) => n.padre === luogo.id && n.x == null);
    const gruppi = [
      [figli.filter((f) => f.tipo !== 'voce'), luogo.appunti ?? 'destra'],
      [figli.filter((f) => f.tipo === 'voce'), luogo.voci ?? 'sinistra'],
    ];
    for (const [blocchi, lato] of gruppi) {
      const n = blocchi.length;
      if (!n) continue;
      const centro = ((LATI[lato] ?? Number(lato) ?? 0) * Math.PI) / 180;
      const dueFile = n > 3;
      // Il ventaglio si allarga con il numero di carte, fino a poco meno di mezzo giro.
      const ampiezza = Math.min((150 * Math.PI) / 180, Math.max((n * 30 * Math.PI) / 180, 0.35));
      // Abbastanza lontano perché due carte della stessa fila non si tocchino.
      const passo = (dueFile ? 2 : 1) * (ampiezza / n);
      const raggio = Math.max(DISTANZA_MIN, DISTACCO / (2 * Math.sin(passo / 2)));
      blocchi.forEach((b, i) => {
        const a = centro - ampiezza / 2 + ((i + 0.5) * ampiezza) / n + scarto(b.id, 'a') * 0.05;
        const r = raggio + (dueFile && i % 2 ? TRA_FILE : 0) + scarto(b.id, 'r') * 18;
        pos.set(b.id, { x: Math.round(luogo.x + r * Math.cos(a)), y: Math.round(luogo.y + r * Math.sin(a)) });
      });
    }
  }
  return pos;
}

// Le fonti del master restano solo testo: le sezioni "Statistiche di gioco" (schede in immagine)
// e le immagini degli appunti stanno nei file locali, non sulla mappa.
function soloTesto(md) {
  const righe = [];
  let salta = 0; // livello del titolo "Statistiche di gioco" che si sta saltando
  for (const r of md.split('\n')) {
    const titolo = r.match(/^(#+) /);
    if (titolo && salta && titolo[1].length <= salta) salta = 0;
    if (!salta && titolo && /^#+ Statistiche di gioco\s*$/.test(r)) salta = titolo[1].length;
    if (!salta) righe.push(r);
  }
  return righe.join('\n').replace(/!\[[^\]]*\]\([^)]*\)\n?/g, '');
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
//   rumor, porta, immagine, codice, master, fonti }
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
        const intero = fonte.sezione ? sezione(await leggi(fonte.file), fonte.sezione) : await leggi(fonte.file);
        const testo = intero && soloTesto(intero);
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
      // Come appare quando è ancora un "?": un testo apposta per i luoghi e per i blocchi a cui porta una pista.
      // Nelle voci del diario "voce" è il numero, non un testo.
      rumor: typeof n.voce === 'object' && n.voce ? n.voce : { titolo: '?', testo: '' },
      // Solo piste verso blocchi pubblicati, ognuna con il suo perché.
      porta: (n.porta ?? []).filter((t) => perId.has(t)),
      perche: n.perche ?? {},
      immagine: foto.get(n.id) ?? null,
      // Chi ha scattato l'immagine e con che licenza, sotto il testo della scheda.
      crediti: n.crediti ? html(n.crediti) : '',
      codice: codici[n.id],
      master: html([n.master, n.noteMaster].filter(Boolean).join('\n\n')),
      fonti,
    });
  }
  return { zone: grafo.zone, nodi };
}

// Tutte le linee della mappa: luogo → blocco ("contiene") e piste verso un altro luogo, nel loro verso.
export function archiCompleti(nodi) {
  const archi = [];
  for (const n of nodi) {
    if (n.padre) archi.push({ da: n.padre, a: n.id, tipo: 'contiene' });
    for (const t of n.porta) archi.push({ da: n.id, a: t, tipo: 'pista', perche: n.perche[t] ?? null });
  }
  return archi;
}
