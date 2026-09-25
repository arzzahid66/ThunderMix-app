/*
 * Per-tab sign-in. sessionStorage lives exactly as long as one tab (it
 * survives reloads but not closing the tab, and a new tab starts empty), so a
 * visitor must enter their private key again in every new tab.
 */
const KEY = "tp_tab_signed_in";

export function markTabSignedIn() {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    // Storage unavailable: the tab check below fails open.
  }
}

export function clearTabSignedIn() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function isTabSignedIn(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    // Without storage we cannot tell tabs apart; don't lock the visitor out.
    return true;
  }
}
