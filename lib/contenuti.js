// Legge gli appunti .md della campagna e ne estrae i pezzi che servono alla mappa.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { marked } from 'marked';

// La cartella della campagna: contiene gli appunti .md e dati-mappa/. Di solito è quella sopra il repository.
export const CARTELLA_CAMPAGNA = path.resolve(process.env.SHEPHERD_CAMPAGNA ?? path.join(import.meta.dirname, '..', '..'));

export async function leggiAppunto(file) {
  return readFile(path.join(CARTELLA_CAMPAGNA, file), 'utf8');
}

export function html(md) {
  return md ? marked.parse(md) : '';
}

// Il testo sotto un titolo, fino al prossimo titolo dello stesso livello o superiore.
export function sezione(md, titolo) {
  const righe = md.split('\n');
  const inizio = righe.findIndex(
    (r) => /^#{1,6} /.test(r) && r.replace(/^#+\s*/, '').trim() === titolo
  );
  if (inizio < 0) return null;
  const livello = righe[inizio].match(/^#+/)[0].length;
  let fine = righe.length;
  for (let i = inizio + 1; i < righe.length; i++) {
    const m = righe[i].match(/^(#+) /);
    if (m && m[1].length <= livello) {
      fine = i;
      break;
    }
  }
  return righe.slice(inizio + 1, fine).join('\n').replace(/\n-{3,}\s*$/, '').trim();
}

// Il primo blockquote dopo "Da leggere ai giocatori".
export function testoGiocatori(md) {
  const righe = md.split('\n');
  const i = righe.findIndex((r) => /Da leggere ai giocatori/i.test(r));
  if (i < 0) return null;
  const citazione = [];
  for (const r of righe.slice(i + 1)) {
    if (r.startsWith('>')) citazione.push(r);
    else if (r.trim() === '' && citazione.length === 0) continue;
    else break;
  }
  return togliCitazione(citazione);
}

// I blocchi di testo citato (">") che seguono la prima riga contenente "dopo".
// Serve per i "da leggere" dei tiri in Sessione 1, che non hanno un titolo proprio.
export function citazioniDopo(md, dopo) {
  const righe = md.split('\n');
  const i = righe.findIndex((r) => r.includes(dopo));
  if (i < 0) return null;
  const citazione = [];
  for (const r of righe.slice(i + 1)) {
    if (r.startsWith('>')) citazione.push(r);
    else if (r.trim() === '') {
      if (citazione.length) citazione.push('>');
    } else if (citazione.length || /^(#|\*\*)/.test(r)) break;
  }
  return togliCitazione(citazione);
}

function togliCitazione(righe) {
  return righe
    .map((r) => r.replace(/^>\s?/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseVoci(md) {
  return md
    .split(/^## /m)
    .slice(1)
    .map((blocco) => {
      const [intestazione, ...corpo] = blocco.split('\n');
      const m = intestazione.match(/^Voce\s+(\S+)\s*-\s*([\d.]+)(?:\s*·\s*età\s*(\d+))?/);
      if (!m) return null;
      return {
        numero: m[1],
        data: m[2],
        eta: m[3] ? Number(m[3]) : null,
        testo: togliCitazione(corpo.filter((r) => r.startsWith('>'))),
      };
    })
    .filter(Boolean);
}
