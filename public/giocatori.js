// Sito dei giocatori. Funziona senza server: blocchi.json contiene ogni blocco cifrato con il suo codice.
// Chi inserisce un codice ricava la chiave (PBKDF2), trova il blocco e lo decifra (AES-GCM).
// I codici inseriti restano salvati in questo browser.
import { $, el, riempi, creaMappa, mostraScheda, nascondiScheda, legame as pulsante, gruppiDiFrecce, TIPI } from './mappa.js';
import { daBase64, deriva, leggiJsonCifrato, immagineCifrata } from './cifra.js';

const CHIAVE_CODICI = 'shepherd-codici';
const CHIAVE_VISTI = 'shepherd-visti';

function leggiLista(chiave) {
  try {
    return JSON.parse(localStorage.getItem(chiave) ?? '[]');
  } catch {
    return [];
  }
}

function salvaLista(chiave, valori) {
  try {
    localStorage.setItem(chiave, JSON.stringify([...valori]));
  } catch {}
}

const normalizza = (c) => String(c).toUpperCase().replace(/[^0-9A-F]/g, '');

let archivio = null; // { sale, iterazioni, blocchi: { etichetta: base64 } }
const sbloccati = new Map(); // id → contenuto decifrato
const codici = new Map(); // codice → id del blocco
const visti = new Set(leggiLista(CHIAVE_VISTI));
let selezionato = null;

const mappa = creaMappa({ onSeleziona: seleziona });

// ---------- cifratura ----------

// Restituisce il contenuto del blocco, o null se il codice non apre niente.
async function apri(codice) {
  const { chiave, etichetta } = await deriva(normalizza(codice), archivio.sale, archivio.iterazioni);
  const cifrato = archivio.blocchi[etichetta];
  if (!cifrato) return null;
  const contenuto = await leggiJsonCifrato(chiave, daBase64(cifrato));
  if (contenuto.immagine) contenuto.immagineUrl = await immagineCifrata(chiave, contenuto.immagine).catch(() => null);
  return contenuto;
}

async function caricaArchivio() {
  const r = await fetch('blocchi.json', { cache: 'no-cache' });
  const dati = await r.json();
  archivio = { ...dati, sale: daBase64(dati.sale) };
}

// Riapre tutti i codici salvati (all'avvio, o quando il sito viene rigenerato).
// Un codice che adesso non apre niente resta salvato: se il blocco torna in un aggiornamento, si riapre da solo.
async function riapriTutto() {
  for (const c of sbloccati.values()) if (c.immagineUrl) URL.revokeObjectURL(c.immagineUrl);
  sbloccati.clear();
  const salvati = leggiLista(CHIAVE_CODICI);
  codici.clear();
  for (const codice of salvati) {
    const contenuto = await apri(codice).catch(() => null);
    if (!contenuto) continue;
    sbloccati.set(contenuto.id, contenuto);
    codici.set(codice, contenuto.id);
  }
}

// ---------- dalla lista dei blocchi decifrati alla mappa ----------

function modello() {
  const nodi = new Map();
  const archi = new Map();
  const comeIgnoto = (r) => {
    if (sbloccati.has(r.id) || nodi.has(r.id)) return;
    nodi.set(r.id, { id: r.id, x: r.x, y: r.y, grande: r.grande, tipo: r.grande ? 'luogo' : 'indizio', ignoto: true, titolo: r.rumor?.titolo ?? '?', testo: r.rumor?.testo ?? '' });
  };
  const aggiungiArco = (da, a, tipo, perche = null) => {
    const chiave = tipo === 'contiene' ? `${da}>${a}` : [da, a].sort().join('|');
    if (!archi.has(chiave)) archi.set(chiave, { da, a, tipo, perche });
  };

  for (const c of sbloccati.values()) {
    nodi.set(c.id, { ...c, colore: c.zona?.colore, ignoto: false, altro: c.figli.some((f) => !sbloccati.has(f)), nuovo: !visti.has(c.id) });
  }
  for (const c of sbloccati.values()) {
    // Un blocco trovato in un luogo ancora sconosciuto fa comparire quel luogo come "?".
    if (c.padre) {
      comeIgnoto(c.padre);
      aggiungiArco(c.padre.id, c.id, 'contiene');
    }
    // Ogni pista fa comparire il luogo a cui porta, come "?" finché non viene decifrato.
    for (const l of c.legami) {
      comeIgnoto(l);
      aggiungiArco(c.id, l.id, 'pista', l.perche);
    }
  }
  return {
    nodi: [...nodi.values()],
    archi: [...archi.values()].map((e) => ({ ...e, ignoto: nodi.get(e.da)?.ignoto || nodi.get(e.a)?.ignoto })),
  };
}

let ultimo = { nodi: [], archi: [] };

function disegna(appena) {
  ultimo = modello();
  mappa.disegna(ultimo, { appena });
  const voci = vociScoperte();
  $('#conta-voci').textContent = voci.length;
  $('#apri-diario').hidden = voci.length === 0;
  if (!$('#diario').hidden) disegnaDiario();
  $('#vuoto').hidden = sbloccati.size > 0;
  if (selezionato) seleziona(selezionato, { aggiorna: true });
}

// ---------- scheda ----------

const titoloDi = (id) => ultimo.nodi.find((n) => n.id === id);

function legame(n, perche) {
  return pulsante(n.titolo, perche, { ignoto: n.ignoto, onclick: () => (seleziona(n.id), mappa.vaiA(n.id)) });
}

function seleziona(id, { aggiorna = false } = {}) {
  const n = titoloDi(id);
  if (!n) return chiudi();
  selezionato = id;
  mappa.evidenzia(id);

  if (n.ignoto) {
    mostraScheda(n, [
      el('div', { class: 'scheda-zona' }, 'Pista non esplorata'),
      el('h2', {}, n.titolo),
      n.testo && el('div', { class: 'scheda-testo' }, el('p', {}, n.testo)),
      el('p', { class: 'scheda-sotto' }, 'Ne avete sentito parlare, ma non l\'avete ancora decifrato.'),
    ], { onChiudi: chiudi });
    return;
  }

  const primaVolta = !visti.has(id) && !aggiorna;
  const padre = n.padre && titoloDi(n.padre.id);
  const figli = n.figli.map(titoloDi).filter(Boolean);

  mostraScheda(n, [
    el('div', { class: 'scheda-zona' }, [n.zona?.nome, TIPI[n.tipo]].filter(Boolean).join(' · ')),
    el('h2', {}, n.titolo),
    n.sottotitolo && el('p', { class: 'scheda-sotto' }, n.sottotitolo),
    el('div', { class: `scheda-testo${primaVolta ? ' scrive' : ''}`, html: n.html }),
    n.crediti && el('div', { class: 'scheda-crediti', html: n.crediti }),
    padre && el('div', { class: 'titoletto' }, 'Trovato in'),
    padre && el('div', { class: 'legami' }, legame(padre)),
    figli.length > 0 && el('div', { class: 'titoletto' }, 'Scoperto qui'),
    figli.length > 0 && el('div', { class: 'legami' }, figli.map((f) => legame(f))),
    gruppiDiFrecce(ultimo.archi, id, (altro, perche) => legame(titoloDi(altro), perche)),
  ], { onChiudi: chiudi });

  if (!visti.has(id)) {
    visti.add(id);
    salvaLista(CHIAVE_VISTI, visti);
    document.querySelector(`.nodo[data-id="${id}"] .nuovo-punto`)?.remove();
  }
}

function chiudi() {
  selezionato = null;
  mappa.evidenzia(null);
  nascondiScheda();
}

document.addEventListener('keydown', (e) => e.key === 'Escape' && selezionato && chiudi());

// ---------- diario: tutte le voci decifrate, in ordine ----------

const vociScoperte = () =>
  [...sbloccati.values()].filter((c) => c.tipo === 'voce').sort((a, b) => parseInt(a.voce, 10) - parseInt(b.voce, 10));

function disegnaDiario() {
  riempi($('#elenco-voci'), vociScoperte().map((v) => {
    const luogo = v.padre && titoloDi(v.padre.id);
    return el('article', { class: 'voce-diario' },
      el('div', { class: 'voce-diario-testa' },
        el('strong', {}, `Voce ${v.voce}`),
        v.sottotitolo && el('span', {}, v.sottotitolo),
        el('button', { class: 'vai', onclick: () => (chiudiDiario(), seleziona(v.id), mappa.vaiA(v.id)) }, luogo ? `trovata in ${luogo.titolo}` : 'sulla mappa')
      ),
      el('div', { class: 'voce-diario-testo', html: v.html })
    );
  }));
}

function chiudiDiario() {
  $('#diario').hidden = true;
}

$('#apri-diario').addEventListener('click', () => {
  chiudi();
  disegnaDiario();
  $('#diario').hidden = false;
  $('#elenco-voci').scrollTop = 0;
});
$('#chiudi-diario').addEventListener('click', chiudiDiario);
$('#diario').addEventListener('click', (e) => e.target === e.currentTarget && chiudiDiario());
document.addEventListener('keydown', (e) => e.key === 'Escape' && !$('#diario').hidden && chiudiDiario());

// ---------- inserimento dei codici ----------

const input = $('#codice');

// Mentre si scrive: solo cifre esadecimali, a gruppi di quattro.
input.addEventListener('input', () => {
  const pulito = normalizza(input.value).slice(0, 32);
  input.value = pulito.match(/.{1,4}/g)?.join('-') ?? '';
});

$('#form-codice').addEventListener('submit', async (e) => {
  e.preventDefault();
  const codice = normalizza(input.value);
  if (!codice) return;
  if (codici.has(codice)) {
    input.value = '';
    const id = codici.get(codice);
    avvisa(`Già decifrato · ${sbloccati.get(id).titolo}`);
    seleziona(id);
    return mappa.vaiA(id);
  }

  const bottone = $('#form-codice button');
  bottone.disabled = true;
  const contenuto = await apri(codice).catch(() => null);
  bottone.disabled = false;
  if (!contenuto) {
    const form = $('#form-codice');
    form.classList.remove('errore');
    void form.offsetWidth;
    form.classList.add('errore');
    return avvisa('Codice non valido.', true);
  }

  sbloccati.set(contenuto.id, contenuto);
  codici.set(codice, contenuto.id);
  salvaLista(CHIAVE_CODICI, new Set([...leggiLista(CHIAVE_CODICI), codice]));
  input.value = '';
  input.blur();
  avvisa(`DECIFRATO · ${contenuto.titolo}`);
  disegna(new Set([contenuto.id]));
  seleziona(contenuto.id);
  mappa.vaiA(contenuto.id);
});

let timerAvviso = null;
function avvisa(testo, errore = false) {
  const a = $('#avviso');
  a.textContent = testo;
  a.className = `avviso${errore ? ' errore' : ''}`;
  a.hidden = false;
  clearTimeout(timerAvviso);
  timerAvviso = setTimeout(() => (a.hidden = true), errore ? 2600 : 4000);
}

$('#dimentica').addEventListener('click', async () => {
  if (!confirm('Dimenticare tutti i codici inseriti su questo dispositivo? La mappa tornerà vuota.')) return;
  salvaLista(CHIAVE_CODICI, []);
  salvaLista(CHIAVE_VISTI, []);
  visti.clear();
  chiudi();
  await riapriTutto();
  disegna();
});

// ---------- avvio ----------

await caricaArchivio();
await riapriTutto();
disegna();

// In locale il server avvisa quando rigenera il sito; su GitHub Pages basta ricaricare la pagina.
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  new EventSource('/api/eventi').onmessage = async () => {
    await caricaArchivio();
    await riapriTutto();
    disegna();
  };
}
