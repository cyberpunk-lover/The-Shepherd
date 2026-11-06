// Disegno della mappa in stile registro di bordo di Outer Wilds: carte, linee, trascinamento e zoom,
// scheda in basso. La usano sia il sito dei giocatori sia la pagina master.
const DIMENSIONI = { grande: { l: 156, a: 150 }, piccolo: { l: 100, a: 86 } };
const NS = 'http://www.w3.org/2000/svg';
export const TIPI = { luogo: 'luogo', indizio: 'indizio', dettaglio: 'dettaglio', voce: 'voce del diario', frammento: 'frammento' };

export const $ = (s) => document.querySelector(s);

export function el(tag, attributi = {}, ...figli) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attributi)) {
    if (v == null || v === false) continue;
    if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  return riempi(e, figli, 'append');
}

// Inserisce figli che possono essere liste annidate o valori vuoti (null, false).
export function riempi(nodo, figli, metodo = 'replaceChildren') {
  nodo[metodo](...[figli].flat(Infinity).filter((f) => f != null && f !== false && f !== ''));
  return nodo;
}

function svg(tag, attributi) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attributi)) e.setAttribute(k, v);
  return e;
}

const misure = (n) => DIMENSIONI[n.grande ? 'grande' : 'piccolo'];

// Le piste girano attorno alle carte invece di passarci sotto: un percorso a gomiti su una griglia,
// che evita i blocchi e preferisce poche curve. Due piste possono correre sullo stesso tratto.
const PASSO = 25; // lato di una cella della griglia
const MARGINE = 14; // spazio lasciato libero attorno alle carte
const CURVA = 6; // quanto costa una curva, in celle
const DIREZIONI = [[1, 0], [0, 1], [-1, 0], [0, -1]];

function rettangolo(n, margine) {
  const { l, a } = misure(n);
  return { x1: n.x - l / 2 - margine, y1: n.y - a / 2 - margine, x2: n.x + l / 2 + margine, y2: n.y + a / 2 + margine };
}

function creaGriglia(nodi) {
  const rett = nodi.map((n) => rettangolo(n, MARGINE));
  const x0 = Math.min(...rett.map((r) => r.x1)) - 8 * PASSO;
  const y0 = Math.min(...rett.map((r) => r.y1)) - 8 * PASSO;
  const w = Math.ceil((Math.max(...rett.map((r) => r.x2)) + 8 * PASSO - x0) / PASSO);
  const h = Math.ceil((Math.max(...rett.map((r) => r.y2)) + 8 * PASSO - y0) / PASSO);
  // Per ogni cella, la carta che la copre (-1 se è libera).
  const carta = new Int32Array(w * h).fill(-1);
  rett.forEach((r, i) => {
    for (let cy = Math.floor((r.y1 - y0) / PASSO); cy <= Math.floor((r.y2 - y0) / PASSO); cy++)
      for (let cx = Math.floor((r.x1 - x0) / PASSO); cx <= Math.floor((r.x2 - x0) / PASSO); cx++) carta[cy * w + cx] = i;
  });
  const cella = (x, y) => Math.floor((y - y0) / PASSO) * w + Math.floor((x - x0) / PASSO);
  const centro = (c) => [x0 + ((c % w) + 0.5) * PASSO, y0 + (Math.floor(c / w) + 0.5) * PASSO];
  return { w, h, carta, cella, centro, indice: new Map(nodi.map((n, i) => [n.id, i])) };
}

// A* sugli stati (cella, direzione): un passo costa 1, una curva CURVA in più.
function percorso(g, da, a) {
  const [ida, ia] = [g.indice.get(da.id), g.indice.get(a.id)];
  const inizio = g.cella(da.x, da.y);
  const fine = g.cella(a.x, a.y);
  const [fx, fy] = [fine % g.w, Math.floor(fine / g.w)];
  const stima = (c) => Math.abs((c % g.w) - fx) + Math.abs(Math.floor(c / g.w) - fy);
  const costo = new Float64Array(g.w * g.h * 4).fill(Infinity);
  const prima = new Int32Array(g.w * g.h * 4).fill(-1);
  const coda = new Coda();
  for (let d = 0; d < 4; d++) {
    costo[inizio * 4 + d] = 0;
    coda.metti(stima(inizio), inizio * 4 + d);
  }
  let arrivo = -1;
  while (coda.lunghezza) {
    const [f, s] = coda.togli();
    const [c, d] = [s >> 2, s & 3];
    if (f - stima(c) > costo[s]) continue;
    if (c === fine) {
      arrivo = s;
      break;
    }
    const [cx, cy] = [c % g.w, Math.floor(c / g.w)];
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (d + 2) % 4) continue;
      const [nx, ny] = [cx + DIREZIONI[nd][0], cy + DIREZIONI[nd][1]];
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const nc = ny * g.w + nx;
      const occupata = g.carta[nc];
      if (occupata !== -1 && occupata !== ida && occupata !== ia) continue;
      const ns = nc * 4 + nd;
      const nuovo = costo[s] + 1 + (nd === d ? 0 : CURVA);
      if (nuovo >= costo[ns]) continue;
      costo[ns] = nuovo;
      prima[ns] = s;
      coda.metti(nuovo + stima(nc), ns);
    }
  }
  if (arrivo < 0) return null;
  // Dal fondo all'inizio, tenendo solo i punti in cui la direzione cambia. Gli estremi sono
  // i centri delle celle sotto le carte: un po' fuori dal centro, ma il pezzo dentro la carta viene tagliato.
  const punti = [g.centro(fine)];
  for (let s = arrivo; prima[s] !== -1; s = prima[s]) {
    if ((s & 3) !== (prima[s] & 3)) punti.push(g.centro(prima[s] >> 2));
  }
  punti.push(g.centro(inizio));
  punti.reverse();
  return taglia(taglia(punti, rettangolo(da, 3)).reverse(), rettangolo(a, 3)).reverse();
}

// Toglie l'inizio del percorso che sta dentro il rettangolo, fermandosi sul bordo.
function taglia(punti, r) {
  const dentro = ([x, y]) => x > r.x1 && x < r.x2 && y > r.y1 && y < r.y2;
  let i = 0;
  while (i < punti.length - 1 && dentro(punti[i + 1])) i++;
  if (i >= punti.length - 1) return punti;
  const [p, q] = [punti[i], punti[i + 1]];
  let t = 1;
  for (const [asse, lato] of [[0, r.x1], [0, r.x2], [1, r.y1], [1, r.y2]]) {
    const delta = q[asse] - p[asse];
    if (!delta) continue;
    const u = (lato - p[asse]) / delta;
    if (u >= 0 && u < t) {
      const altro = p[1 - asse] + (q[1 - asse] - p[1 - asse]) * u;
      if (altro >= (asse ? r.x1 : r.y1) && altro <= (asse ? r.x2 : r.y2)) t = u;
    }
  }
  return [[p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], ...punti.slice(i + 1)];
}

// Il punto a metà di una spezzata, con la direzione del tratto in cui cade.
function meta(punti) {
  const tratti = punti.slice(1).map((q, i) => [punti[i], q, Math.hypot(q[0] - punti[i][0], q[1] - punti[i][1])]);
  let resto = tratti.reduce((s, t) => s + t[2], 0) / 2;
  for (const [p, q, l] of tratti) {
    if (resto <= l && l > 0) {
      const [ux, uy] = [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
      return { x: p[0] + ux * resto, y: p[1] + uy * resto, ux, uy };
    }
    resto -= l;
  }
  return { x: punti[0][0], y: punti[0][1], ux: 1, uy: 0 };
}

// Coda con priorità (heap binario) per l'A*.
class Coda {
  constructor() {
    this.dati = [];
  }
  get lunghezza() {
    return this.dati.length;
  }
  metti(priorita, valore) {
    const d = this.dati;
    d.push([priorita, valore]);
    for (let i = d.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (d[p][0] <= d[i][0]) break;
      [d[p], d[i]] = [d[i], d[p]];
      i = p;
    }
  }
  togli() {
    const d = this.dati;
    const primo = d[0];
    const ultimo = d.pop();
    if (d.length) {
      d[0] = ultimo;
      for (let i = 0; ; ) {
        const [s, t] = [2 * i + 1, 2 * i + 2];
        let m = i;
        if (s < d.length && d[s][0] < d[m][0]) m = s;
        if (t < d.length && d[t][0] < d[m][0]) m = t;
        if (m === i) break;
        [d[m], d[i]] = [d[i], d[m]];
        i = m;
      }
    }
    return primo;
  }
}

// L'immagine di una carta: foto del luogo (o X rossa), numero della voce, disegnino, oppure "?".
export function figura(n) {
  const box = el('div', { class: 'nodo-immagine' });
  if (n.ignoto) return riempi(box, el('span', { class: 'punto-domanda' }, '?'));
  if (n.immagineUrl) return riempi(box, el('img', { src: n.immagineUrl, alt: '', draggable: 'false' }));
  if (n.tipo === 'luogo') {
    box.classList.add('segnaposto');
    box.innerHTML = '<svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M8 8L92 92M92 8L8 92"/></svg>';
    return box;
  }
  if (n.tipo === 'voce') return riempi(box, el('div', { class: 'numero-voce' }, el('small', {}, 'VOCE'), n.voce));
  box.innerHTML = n.disegnoSvg ?? '';
  return box;
}

export function creaMappa({ onSeleziona }) {
  const contenitore = $('#mappa');
  const tela = $('#tela');
  const vista = { x: 0, y: 0, k: 1 };
  let modello = { nodi: [], archi: [] };
  let selezionato = null;
  let primaVolta = true;
  let mossa = false;
  let trascinato = false;

  const perId = (id) => modello.nodi.find((n) => n.id === id);

  function carta(n, appena) {
    const { l, a } = misure(n);
    return el('button', {
      class: ['nodo', n.grande ? 'grande' : 'piccolo', n.ignoto && 'ignoto', n.bloccato && 'bloccato', appena && 'appena'].filter(Boolean).join(' '),
      style: `left:${n.x - l / 2}px;top:${n.y - a / 2}px;width:${l}px;height:${a}px;${n.colore ? `--zona:${n.colore}` : ''}`,
      'data-id': n.id,
      'aria-label': n.ignoto ? `Pista non esplorata: ${n.titolo}` : n.titolo,
      onclick: () => !trascinato && onSeleziona(n.id),
    },
      el('div', { class: 'nodo-testa' }, n.titolo),
      figura(n),
      n.altro && el('span', { class: 'altro', title: "C'è altro da scoprire qui" }, '*'),
      n.nuovo && el('span', { class: 'nuovo-punto', title: 'Novità' })
    );
  }

  // Dove la linea tra due centri esce dal bordo della carta.
  function bordo(da, verso) {
    const { l, a } = misure(da);
    const dx = verso.x - da.x;
    const dy = verso.y - da.y;
    const t = Math.min((l / 2 + 3) / Math.abs(dx || 1e-6), (a / 2 + 3) / Math.abs(dy || 1e-6));
    return [da.x + dx * t, da.y + dy * t];
  }

  function disegna(nuovoModello, { appena = new Set() } = {}) {
    modello = nuovoModello;
    riempi($('#nodi'), modello.nodi.map((n) => carta(n, appena.has(n.id))));
    const archi = $('#archi');
    archi.replaceChildren();
    const griglia = modello.nodi.length ? creaGriglia(modello.nodi) : null;
    for (const e of modello.archi) {
      const da = perId(e.da);
      const a = perId(e.a);
      if (!da || !a) continue;
      const classe = ['arco', e.tipo, e.ignoto && 'ignoto', e.spento && 'spento'].filter(Boolean).join(' ');
      // Le piste prendono il colore, un po' schiarito, del blocco da cui partono; i "trovato in" restano gialli.
      const tinta = e.tipo === 'pista' && da.colore ? `--tinta:color-mix(in srgb, ${da.colore} 85%, #fff)` : '';
      const punti = percorso(griglia, da, a) ?? [bordo(da, a), bordo(a, da)];
      archi.append(svg('polyline', { points: punti.map((p) => p.join(',')).join(' '), class: classe, style: tinta, 'data-da': e.da, 'data-a': e.a }));
      if (e.tipo !== 'pista') continue;
      // Le piste hanno una punta a metà che dice il verso: da chi lo dice a ciò di cui parla.
      const { x: mx, y: my, ux, uy } = meta(punti);
      const punte = [[mx + ux * 8, my + uy * 8], [mx - ux * 6 - uy * 6, my - uy * 6 + ux * 6], [mx - ux * 6 + uy * 6, my - uy * 6 - ux * 6]];
      archi.append(svg('polygon', { points: punte.map((p) => p.join(',')).join(' '), class: classe.replace('arco', 'tappa'), style: tinta, 'data-da': e.da, 'data-a': e.a }));
      // Il perché della freccia, visibile quando si seleziona uno dei due blocchi.
      if (e.perche) {
        const testo = svg('text', { x: mx - uy * 16, y: my + ux * 16 + 4, class: 'motivo', 'text-anchor': 'middle', 'data-da': e.da, 'data-a': e.a });
        testo.textContent = e.perche;
        archi.append(testo);
      }
    }
    if (primaVolta && modello.nodi.length) {
      primaVolta = false;
      centra();
    } else {
      applica();
    }
    evidenzia(selezionato);
  }

  function evidenzia(id) {
    selezionato = id;
    document.querySelectorAll('.nodo').forEach((c) => c.classList.toggle('selezionato', c.dataset.id === id));
    document.querySelectorAll('.arco, .tappa, .motivo').forEach((a) => a.classList.toggle('evidenziato', !!id && (a.dataset.da === id || a.dataset.a === id)));
  }

  function applica() {
    tela.style.transform = `translate(${vista.x}px, ${vista.y}px) scale(${vista.k})`;
  }

  function centra() {
    if (!modello.nodi.length) return;
    const r = contenitore.getBoundingClientRect();
    if (r.width < 50 || r.height < 50) return;
    mossa = false;
    const xs = modello.nodi.flatMap((n) => [n.x - misure(n).l / 2, n.x + misure(n).l / 2]);
    const ys = modello.nodi.flatMap((n) => [n.y - misure(n).a / 2, n.y + misure(n).a / 2]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const margine = r.width < 760 ? 32 : 110;
    const alto = r.width < 760 ? 120 : 90; // spazio per la testata
    vista.k = Math.max(0.2, Math.min((r.width - 2 * margine) / (maxX - minX), (r.height - alto - margine) / (maxY - minY), 1.15));
    vista.x = r.width / 2 - ((minX + maxX) / 2) * vista.k;
    vista.y = alto + (r.height - alto - margine) / 2 - ((minY + maxY) / 2) * vista.k;
    applica();
  }

  function zoom(px, py, fattore) {
    mossa = true;
    const k = Math.min(2.5, Math.max(0.15, vista.k * fattore));
    vista.x = px - (px - vista.x) * (k / vista.k);
    vista.y = py - (py - vista.y) * (k / vista.k);
    vista.k = k;
    applica();
  }

  // Porta un blocco al centro della parte di schermo sopra la scheda.
  function vaiA(id) {
    const n = perId(id);
    if (!n) return;
    mossa = true;
    const r = contenitore.getBoundingClientRect();
    const scheda = $('#scheda').hidden ? 0 : $('#scheda').getBoundingClientRect().height;
    vista.x = r.width / 2 - n.x * vista.k;
    vista.y = (r.height - scheda) / 2 + 30 - n.y * vista.k;
    applica();
  }

  // Trascinamento e zoom, anche con due dita.
  const puntatori = new Map();
  let trascinamento = null;
  let pizzico = null;

  contenitore.addEventListener('pointerdown', (e) => {
    puntatori.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (puntatori.size === 1) {
      trascinamento = { x: e.clientX, y: e.clientY, vx: vista.x, vy: vista.y };
      trascinato = false;
    } else if (puntatori.size === 2) {
      const [p, q] = [...puntatori.values()];
      pizzico = { distanza: Math.hypot(p.x - q.x, p.y - q.y) };
      trascinamento = null;
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!puntatori.has(e.pointerId)) return;
    puntatori.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pizzico && puntatori.size === 2) {
      const [p, q] = [...puntatori.values()];
      const distanza = Math.hypot(p.x - q.x, p.y - q.y);
      zoom((p.x + q.x) / 2, (p.y + q.y) / 2, distanza / pizzico.distanza);
      pizzico.distanza = distanza;
      trascinato = true;
      return;
    }
    if (!trascinamento) return;
    const dx = e.clientX - trascinamento.x;
    const dy = e.clientY - trascinamento.y;
    if (!trascinato && Math.hypot(dx, dy) < 5) return;
    trascinato = true;
    mossa = true;
    contenitore.classList.add('trascina');
    vista.x = trascinamento.vx + dx;
    vista.y = trascinamento.vy + dy;
    applica();
  });

  function rilascia(e) {
    puntatori.delete(e.pointerId);
    if (puntatori.size < 2) pizzico = null;
    if (puntatori.size === 0) {
      trascinamento = null;
      contenitore.classList.remove('trascina');
      setTimeout(() => (trascinato = false));
    }
  }
  window.addEventListener('pointerup', rilascia);
  window.addEventListener('pointercancel', rilascia);

  contenitore.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  // WASD per spostarsi sulla mappa: scorre finché il tasto resta premuto, anche in diagonale.
  const TASTI = { w: [0, 1], a: [1, 0], s: [0, -1], d: [-1, 0] };
  const VELOCITA = 14; // pixel per fotogramma
  const premuti = new Set();
  let animazione = null;
  function scorri() {
    let [dx, dy] = [0, 0];
    for (const t of premuti) {
      dx += TASTI[t][0];
      dy += TASTI[t][1];
    }
    if (dx || dy) {
      mossa = true;
      vista.x += dx * VELOCITA;
      vista.y += dy * VELOCITA;
      applica();
    }
    animazione = premuti.size ? requestAnimationFrame(scorri) : null;
  }
  window.addEventListener('keydown', (e) => {
    const t = e.key.toLowerCase();
    if (!TASTI[t] || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    premuti.add(t);
    animazione ??= requestAnimationFrame(scorri);
  });
  window.addEventListener('keyup', (e) => premuti.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => premuti.clear());

  const zoomAlCentro = (f) => zoom(innerWidth / 2, innerHeight / 2, f);
  $('#zoom-piu').addEventListener('click', () => zoomAlCentro(1.25));
  $('#zoom-meno').addEventListener('click', () => zoomAlCentro(0.8));
  $('#centra').addEventListener('click', centra);
  // Finché nessuno ha spostato la mappa, resta centrata anche quando cambia la finestra.
  new ResizeObserver(() => !mossa && centra()).observe(contenitore);

  return { disegna, evidenzia, centra, vaiA, nodo: perId };
}

// La scheda in basso: figura a sinistra, testo a destra. "parti" sono gli elementi della colonna di testo.
export function mostraScheda(n, parti, { onChiudi }) {
  const p = $('#scheda');
  const scroll = p.dataset.id === n.id ? p.scrollTop : 0;
  p.hidden = false;
  p.dataset.id = n.id;
  p.className = `scheda ${n.tipo}`;
  p.style.cssText = n.colore ? `--zona:${n.colore}` : '';
  riempi(p, [
    el('button', { class: 'chiudi', 'aria-label': 'Chiudi', onclick: onChiudi }, '×'),
    el('div', { class: 'scheda-figura' }, figura(n)),
    el('div', {}, parti),
  ]);
  p.scrollTop = scroll;
}

// Un pulsante che porta a un altro blocco, con il motivo del collegamento sotto.
export function legame(titolo, perche, { ignoto = false, onclick }) {
  return el('button', { class: `legame${ignoto ? ' ignoto' : ''}`, onclick },
    el('span', {}, ignoto ? `? ${titolo}` : titolo),
    perche && el('span', { class: 'perche' }, perche)
  );
}

// Le piste di un blocco: dove porta e da dove ci si arriva.
export function gruppiDiFrecce(archi, id, crea) {
  const piste = archi.filter((e) => e.tipo === 'pista' && (e.da === id || e.a === id));
  const gruppi = [
    ['Porta a', piste.filter((e) => e.da === id), 'a'],
    ['Ci si arriva da', piste.filter((e) => e.a === id), 'da'],
  ];
  return gruppi
    .filter(([, lista]) => lista.length)
    .map(([titolo, lista, verso]) => [el('div', { class: 'titoletto' }, titolo), el('div', { class: 'legami' }, lista.map((e) => crea(e[verso], e.perche)))]);
}

export function nascondiScheda() {
  const p = $('#scheda');
  p.hidden = true;
  delete p.dataset.id;
}
