/**
 * Speicher-Schnittstelle (Entscheidung vom 4. Oktober 2026): lokal zuerst, später nur die Implementierung wechseln
 * (Ziel: Server in Deutschland). Heute: Antworten auf Nachbar-Links per API in SQLite im eigenen Node-Server
 * (app/scripts/nachbar-api.mjs). Die Lernschleife (Phase 4) bekommt eine zweite Implementierung derselben Art.
 *
 * Gespeichert wird je Antwort nur: Zeitpunkt, Antwort, Projekt-Hash – dazu die Link-Kennung (Zuordnung) und eine
 * zufällige Antwort-Kennung (damit der Nachbar seine Antwort löschen kann). Kein Name, keine Adresse, keine IP.
 */
export type NachbarAntwort = 'passt' | 'frage';

export interface GespeicherteAntwort {
  zeit: string;
  antwort: NachbarAntwort;
  hash: string;
}

export interface NachbarSpeicher {
  /** Antwort senden; liefert die Antwort-Kennung (zum Löschen durch den Nachbarn) */
  antworten(link: string, antwort: NachbarAntwort, hash: string, bis: string): Promise<string>;
  /** Antwort löschen (Nachbar, mit Antwort-Kennung) */
  antwortLoeschen(id: string): Promise<void>;
  /** Ist der Link zurückgezogen? */
  zurueckgezogen(link: string): Promise<boolean>;
  /** Antworten abrufen (Ersteller, mit Schlüssel) */
  abrufen(link: string, schluessel: string): Promise<GespeicherteAntwort[]>;
  /** Link zurückziehen: keine neuen Antworten mehr (Ersteller) */
  zurueckziehen(link: string, schluessel: string): Promise<void>;
  /** Alle Antworten zu diesem Link löschen und zurückziehen (Ersteller) */
  allesLoeschen(link: string, schluessel: string): Promise<void>;
}

export class SpeicherFehler extends Error {}

async function rufe<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } });
  } catch {
    throw new SpeicherFehler('Der Server ist nicht erreichbar.');
  }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new SpeicherFehler(t || `Fehler ${r.status}`);
  }
  return (r.status === 204 ? undefined : await r.json()) as T;
}

/** Implementierung über die HTTP-API des Node-Servers (scripts/serve.mjs bzw. Vite-Dev-Server). */
export function apiSpeicher(basis = `${import.meta.env.BASE_URL ?? '/'}api/nachbar`.replace(/\/\//g, '/')): NachbarSpeicher {
  const post = <T>(pfad: string, body: unknown) => rufe<T>(`${basis}${pfad}`, { method: 'POST', body: JSON.stringify(body) });
  return {
    antworten: async (link, antwort, hash, bis) => (await post<{ id: string }>('/antwort', { link, antwort, hash, bis })).id,
    antwortLoeschen: (id) => rufe<void>(`${basis}/antwort/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    zurueckgezogen: async (link) => (await rufe<{ zurueckgezogen: boolean }>(`${basis}/link/${encodeURIComponent(link)}`)).zurueckgezogen,
    abrufen: async (link, schluessel) => (await post<{ antworten: GespeicherteAntwort[] }>(`/link/${encodeURIComponent(link)}/abruf`, { schluessel })).antworten,
    zurueckziehen: (link, schluessel) => post<void>(`/link/${encodeURIComponent(link)}/widerruf`, { schluessel }),
    allesLoeschen: (link, schluessel) => post<void>(`/link/${encodeURIComponent(link)}/loeschen`, { schluessel }),
  };
}
