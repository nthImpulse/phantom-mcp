/**
 * Extract an attribute value from an XML tag's attribute string.
 * Shared between iOS (WDA) and Android (UIAutomator) XML parsers.
 */
export function getAttr(attrs: string, name: string): string {
  const match = attrs.match(new RegExp(`${name}="([^"]*)"`, "i"));
  if (!match) return "";
  return match[1]
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
