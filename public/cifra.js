// Decifratura nel browser, la stessa per i blocchi dei giocatori e per il file del master.
// Corrisponde a lib/costruisci.js: PBKDF2-SHA256 → 48 byte (chiave AES + etichetta), poi AES-GCM con IV in testa.

export const daBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const esadecimale = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

export async function derivaBit(segreto, sale, iterazioni) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(segreto), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: sale, iterations: iterazioni, hash: 'SHA-256' }, base, 384));
}

export const chiaveAes = (byte) => crypto.subtle.importKey('raw', byte, 'AES-GCM', false, ['decrypt']);

export async function deriva(segreto, sale, iterazioni) {
  const bit = await derivaBit(segreto, sale, iterazioni);
  return { chiave: await chiaveAes(bit.slice(0, 32)), etichetta: esadecimale(bit.slice(32, 48)) };
}

export async function decifra(chiave, dati) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: dati.slice(0, 12) }, chiave, dati.slice(12)));
}

export const leggiJsonCifrato = async (chiave, dati) => JSON.parse(new TextDecoder().decode(await decifra(chiave, dati)));

// Scarica un'immagine cifrata e la rende usabile come <img src>.
export async function immagineCifrata(chiave, { file, tipo }) {
  const risposta = await fetch(file);
  const chiaro = await decifra(chiave, new Uint8Array(await risposta.arrayBuffer()));
  return URL.createObjectURL(new Blob([chiaro], { type: tipo }));
}
