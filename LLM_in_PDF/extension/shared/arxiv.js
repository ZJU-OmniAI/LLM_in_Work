// One validator for redirects, the popup and the PDF reader (including legacy IDs).
export const ID_PATTERN = '(?:[0-9]{4}\\.[0-9]{4,5}|[a-z-]+(?:\\.[a-z]{2})?/[0-9]{7})(?:v[0-9]+)?';
export function validId(value) {
  return typeof value === 'string' && new RegExp(`^${ID_PATTERN}$`, 'i').test(value) ? value : null;
}
export function arxivId(url) {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol) || !/(^|\.)arxiv\.org$/i.test(parsed.hostname)) return null;
    if (!/^\/(abs|pdf|html|format)\//.test(parsed.pathname)) return null;
    return validId(parsed.pathname.replace(/^\/(?:abs|pdf|html|format)\//, '').replace(/\.pdf$/i, ''));
  } catch { return null; }
}
export function pdfRules(readerUrl) {
  return [
    { id: 6101, priority: 1, action: { type: 'redirect', redirect: { regexSubstitution: `${readerUrl}?id=\\1` } },
      condition: { regexFilter: `^https?://(?:[a-z0-9-]+\\.)*arxiv\\.org/pdf/(${ID_PATTERN})(?:\\.pdf)?(?:[?#].*)?$`, resourceTypes: ['main_frame'] } },
    // Explicit escape hatch for the original browser viewer.
    { id: 6102, priority: 2, action: { type: 'allow' },
      condition: { regexFilter: '^https?://(?:[a-z0-9-]+\\.)*arxiv\\.org/pdf/[^?]+\\?(?:[^#]*&)?paper_read_native=1(?:[&#]|$)', resourceTypes: ['main_frame'] } },
  ];
}
