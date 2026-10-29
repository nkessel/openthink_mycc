// The map shows small WebP copies of the logos (public/logos/web/, made by scripts/web-logos.py) when there is one:
// about a quarter of the download, the biggest part of the first load (Oct 29). The sheet keeps the original
// paths, and a logo with no copy (a new one, or a link to another site) shows as it is.
import WEB from "./logos.web.json";

const HAVE = new Set<string>(WEB as string[]);

/** "logos/x.png" → "logos/web/x.webp" when that copy exists; anything else unchanged. */
export function webLogo(url: string | undefined): string | undefined {
  if (!url) return url;
  const m = /^(\.?\/?)logos\/([^/?#]+)$/.exec(url);
  if (!m || !HAVE.has(m[2])) return url;
  return `${m[1]}logos/web/${m[2].replace(/\.[a-z]+$/i, "")}.webp`;
}
