export function themeAt(hour) {
  return hour >= 20 || hour < 7 ? "dark" : "light";
}
export function readPreference(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
export function savePreference(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Reading works without localStorage. */
  }
}
export function resolvedTheme(mode, date = new Date()) {
  return mode === "auto" ? themeAt(date.getHours()) : mode;
}
