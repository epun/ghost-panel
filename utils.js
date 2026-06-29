// Shared internal utilities.

export function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
export function clamp01(x) { return Math.max(0, Math.min(1, x)); }
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[ch]));
}
