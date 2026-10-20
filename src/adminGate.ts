// Soft gate for the demo Administrator persona: it appears in "Signed in as" only in a
// browser where the passphrase was entered. Only a SHA-256 fingerprint of the passphrase
// is in the code. This is not security (anyone can read and change a browser app);
// it keeps the all-access role out of reviewers' way. Each browser's data is its own.

const ADMIN_HASH = "d4c3ec40a876f49ad9686b766f9cbc6d2bee522711bad2705be6ece5a0f55de7";
const KEY = "neocloud-admin-unlocked";

export function adminUnlocked(): boolean {
  try {
    return window.localStorage.getItem(KEY) === ADMIN_HASH;
  } catch {
    return false;
  }
}

async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** True and remembered in this browser when the passphrase matches. */
export async function unlockAdmin(passphrase: string): Promise<boolean> {
  if ((await sha256(passphrase.trim())) !== ADMIN_HASH) return false;
  try {
    window.localStorage.setItem(KEY, ADMIN_HASH);
  } catch {
    /* storage unavailable: unlocked for this page only */
  }
  return true;
}

export function lockAdmin(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to remove */
  }
}
