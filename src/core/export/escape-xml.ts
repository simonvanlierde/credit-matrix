/** Characters XML 1.0 cannot carry at all, escaped or not: most C0 controls, lone surrogates, U+FFFE/U+FFFF. */
const XML_INVALID = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

/**
 * Escape the five XML predefined entities for safe inclusion in element text or
 * attributes, and drop characters XML cannot hold, which would make the file unreadable.
 */
export function escapeXml(s: string): string {
  return s
    .replace(XML_INVALID, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
