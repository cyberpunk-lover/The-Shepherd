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
    for (const e of modello.archi) {
      const da = perId(e.da);
      const a = perId(e.a);
      if (!da || !a) continue;
      const [x1, y1] = bordo(da, a);
      const [x2, y2] = bordo(a, da);
      // "porta": la pista che fa comparire un luogo; "spiega": un blocco che chiarisce un altro.
      const tipo = e.tipo === 'pista' ? (e.porta ? 'porta' : 'spiega') : e.tipo;
      const classe = ['arco', tipo, e.ignoto && 'ignoto', e.spento && 'spento'].filter(Boolean).join(' ');
      archi.append(svg('line', { x1, y1, x2, y2, class: classe, 'data-da': e.da, 'data-a': e.a }));
      // Le piste hanno una punta a metà che dice il verso: da chi lo dice a ciò di cui parla.
      if (e.tipo === 'pista') {
        const lung = Math.hypot(x2 - x1, y2 - y1) || 1;
        const [ux, uy] = [(x2 - x1) / lung, (y2 - y1) / lung];
        const [mx, my] = [(x1 + x2) / 2, (y1 + y2) / 2];
        const punte = [[mx + ux * 8, my + uy * 8], [mx - ux * 6 - uy * 6, my - uy * 6 + ux * 6], [mx - ux * 6 + uy * 6, my - uy * 6 - ux * 6]];
        archi.append(svg('polygon', { points: punte.map((p) => p.join(',')).join(' '), class: classe.replace('arco', 'tappa'), 'data-da': e.da, 'data-a': e.a }));
        // Il perché della freccia, visibile quando si seleziona uno dei due blocchi.
        if (e.perche) {
          const testo = svg('text', { x: mx - uy * 16, y: my + ux * 16 + 4, class: 'motivo', 'text-anchor': 'middle', 'data-da': e.da, 'data-a': e.a });
          testo.textContent = e.perche;
          archi.append(testo);
        }
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

// Le frecce di un blocco divise per significato: dove porta, cosa spiega, da dove ci si arriva.
export function gruppiDiFrecce(archi, id, crea) {
  const piste = archi.filter((e) => e.tipo === 'pista' && (e.da === id || e.a === id));
  const gruppi = [
    ['Porta a', piste.filter((e) => e.da === id && e.porta), 'a'],
    ['Spiega', piste.filter((e) => e.da === id && !e.porta), 'a'],
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
