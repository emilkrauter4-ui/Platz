export interface Teil { name: string; farbe: [number, number, number]; pos: number[]; nrm: number[]; idx: number[] }
export function teileAus(p: Record<string, string | number | undefined>): Teil[];
export function glb(teile: Teil[]): Uint8Array;
export function usda(teile: Teil[]): string;
export function usdz(teile: Teil[]): Uint8Array;
export function arApi(req: unknown, res: unknown): boolean;
