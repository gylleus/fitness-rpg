export const healthName = 'Health service';
export async function healthAvailable() { return false; }
export async function healthAuthorized() { return false; }
export async function authorizeHealth() { return false; }
export async function readHealthSteps(_start: number, _end: number): Promise<number> { throw new Error('Step syncing requires an Android phone or iPhone.'); }
export async function openHealthSettings() {}
