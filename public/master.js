// Pagina del master: tutta la mappa, le note e i codici. È statica come quella dei giocatori:
// master.json è cifrato con la password del master e si apre nel browser, online o in locale.
import { $, el, riempi, creaMappa, mostraScheda, nascondiScheda, legame as pulsante, gruppiDiFrecce, TIPI } from './mappa.js';
import { daBase64, derivaBit, chiaveAes, deriva, leggiJsonCifrato, immagineCifrata } from './cifra.js';

// La chiave (non la password) resta in memoria finché la scheda del browser è aperta.
const CHIAVE_SESSIONE = 'shepherd-master';

let dati = null;
let selezionato = null;
const mappa = creaMappa({ onSeleziona: seleziona });
const perId = (id) => dati.nodi.find((n) => n.id === id);

async function scarica(file) {
  const r = await fetch(file, { cache: 'no-cache' });
  return r.json();
}

async function apri(chiaveGrezza) {
  const file = await scarica('master.json');
  try {
    dati = await leggiJsonCifrato(await chiaveAes(chiaveGrezza), daBase64(file.dati));
  } catch {
    return false;
  }
  $('#accesso').hidden = true;
  mostra();
  caricaImmagini();
  return true;
}

function mostra() {
  mappa.disegna({
    nodi: dati.nodi.map((n) => ({ ...n, colore: n.zona?.colore })),
    archi: dati.archi,
  });
  if (selezionato) seleziona(selezionato);
  if (!$('#codici').hidden) disegnaCodici();
}

// Le foto dei luoghi sono cifrate col codice del loro blocco, che il master conosce.
async function caricaImmagini() {
  const conImmagine = dati.nodi.filter((n) => n.immagine);
  if (!conImmagine.length) return;
  const blocchi = await scarica('blocchi.json');
  const sale = daBase64(blocchi.sale);
  for (const n of conImmagine) {
    const codice = n.codice.toUpperCase().replace(/[^0-9A-F]/g, '');
    const { chiave } = await deriva(codice, sale, blocchi.iterazioni);
    n.immagineUrl = await immagineCifrata(chiave, n.immagine).catch(() => null);
  }
  mostra();
}

function copia(testo, bottone) {
  navigator.clipboard?.writeText(testo).then(() => {
    const prima = bottone.textContent;
    bottone.textContent = 'copiato';
    setTimeout(() => (bottone.textContent = prima), 1200);
  });
}

function legame(id, perche) {
  return pulsante(perId(id).titolo, perche, { onclick: () => (seleziona(id), mappa.vaiA(id)) });
}

function seleziona(id) {
  const n = perId(id);
  if (!n) return;
  selezionato = id;
  mappa.evidenzia(id);
  mostraScheda({ ...n, colore: n.zona?.colore }, [
    el('div', { class: 'scheda-zona' }, [n.zona?.nome, TIPI[n.tipo]].filter(Boolean).join(' · ')),
    el('h2', {}, n.titolo),
    n.sottotitolo && el('p', { class: 'scheda-sotto' }, n.sottotitolo),
    el('div', { class: 'riga-codice' },
      el('span', { class: 'codice' }, n.codice),
      el('button', { class: 'piccolo-bottone', onclick: (e) => copia(n.codice, e.currentTarget) }, 'copia')
    ),
    n.tipo === 'luogo' && el('p', { class: 'anteprima-rumor' }, 'Finché non lo decifrano appare come ', el('strong', {}, `? ${n.rumor.titolo}`), ` — ${n.rumor.testo}`),
    el('div', { class: 'scheda-testo', html: n.html }),
    n.padre && el('div', { class: 'titoletto' }, 'Si trova in'),
    n.padre && el('div', { class: 'legami' }, legame(n.padre)),
    n.figli.length > 0 && el('div', { class: 'titoletto' }, 'Blocchi in questo luogo'),
    n.figli.length > 0 && el('div', { class: 'legami' }, n.figli.map((f) => legame(f))),
    gruppiDiFrecce(dati.archi, id, legame),
    n.master && el('div', { class: 'nota-master', html: n.master }),
    n.fonti.map((f) => el('details', { class: 'fonte' }, el('summary', {}, f.etichetta), el('div', { class: 'testo-lungo', html: f.html }))),
  ], { onChiudi: chiudi });
}

function chiudi() {
  selezionato = null;
  mappa.evidenzia(null);
  nascondiScheda();
}

// ---------- elenco dei codici ----------

function disegnaCodici() {
  const filtro = $('#filtro-codici').value.trim().toLowerCase();
  const gruppi = dati.nodi.filter((n) => n.tipo === 'luogo').map((luogo) => {
    const blocchi = [luogo, ...luogo.figli.map(perId)]
      .filter((n) => !filtro || `${n.titolo} ${n.codice} ${TIPI[n.tipo]}`.toLowerCase().includes(filtro));
    if (!blocchi.length) return null;
    return el('section', { class: 'gruppo-codici', style: `--zona:${luogo.zona?.colore}` },
      el('h3', {}, `${luogo.titolo} · ${luogo.zona?.nome}`),
      blocchi.map((n) =>
        el('div', { class: 'riga' },
          el('button', { class: 'vai', onclick: () => (chiudiCodici(), seleziona(n.id), mappa.vaiA(n.id)) }, n.titolo),
          el('span', { class: 'riga-tipo' }, TIPI[n.tipo]),
          el('span', { class: 'codice' }, n.codice),
          el('button', { class: 'piccolo-bottone copia', onclick: (e) => copia(n.codice, e.currentTarget) }, 'copia')
        )
      )
    );
  });
  riempi($('#elenco-codici'), gruppi);
}

function chiudiCodici() {
  $('#codici').hidden = true;
}

$('#apri-codici').addEventListener('click', () => {
  if (!dati) return;
  $('#codici').hidden = false;
  disegnaCodici();
  $('#filtro-codici').focus();
});
$('#chiudi-codici').addEventListener('click', chiudiCodici);
$('#codici').addEventListener('click', (e) => e.target === e.currentTarget && chiudiCodici());
$('#filtro-codici').addEventListener('input', disegnaCodici);
$('#stampa-codici').addEventListener('click', () => window.print());

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#codici').hidden) chiudiCodici();
  else if (selezionato) chiudi();
});

// ---------- accesso ----------

function chiaveSalvata() {
  try {
    const s = sessionStorage.getItem(CHIAVE_SESSIONE);
    return s ? daBase64(s) : null;
  } catch {
    return null;
  }
}

function salvaChiave(byte) {
  try {
    sessionStorage.setItem(CHIAVE_SESSIONE, btoa(String.fromCharCode(...byte)));
  } catch {}
}

function mostraAccesso() {
  $('#accesso').hidden = false;
  $('#password').focus();
}

$('#form-accesso').addEventListener('submit', async (e) => {
  e.preventDefault();
  const bottone = $('#form-accesso button');
  bottone.disabled = true;
  bottone.textContent = 'Decifro…';
  const file = await scarica('master.json');
  const chiave = (await derivaBit($('#password').value, daBase64(file.sale), file.iterazioni)).slice(0, 32);
  const ok = await apri(chiave);
  bottone.disabled = false;
  bottone.textContent = 'Entra';
  $('#errore-accesso').hidden = ok;
  if (!ok) return;
  salvaChiave(chiave);
  $('#password').value = '';
});

$('#esci').addEventListener('click', () => {
  try {
    sessionStorage.removeItem(CHIAVE_SESSIONE);
  } catch {}
  location.reload();
});

// ---------- avvio ----------

const salvata = chiaveSalvata();
if (!salvata || !(await apri(salvata))) mostraAccesso();

// In locale il server avvisa quando rigenera i file cifrati.
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  new EventSource('/api/eventi').onmessage = async () => {
    const chiave = chiaveSalvata();
    if (chiave) await apri(chiave);
  };
}
