export function tippAnfrage(body: unknown): { x: number; y: number; klasse?: string } | null;
export function vorbereitenAnfrage(body: unknown): { umriss: [number, number][] } | null;
export function tippApi(req: unknown, res: unknown): Promise<void>;
