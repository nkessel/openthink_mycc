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

// Nov 12: tiny 64px copies (public/logos/web/s/, same script) for the small bubbles of the first view: about a sixth
// of the download again. The map swaps in the larger copy for a bubble once it is big on screen.
import SMALL from "./logos.small.json";

const HAVE_SMALL = new Set<string>(SMALL as string[]);
/** Longest side of the small copies, in image pixels. */
export const SMALL_LOGO_PX = 64;

/** "logos/x.png" or "logos/web/x.webp" → "logos/web/s/x.webp" when that copy exists; anything else unchanged. */
export function smallLogo(url: string | undefined): string | undefined {
  if (!url) return url;
  const m = /^(\.?\/?)logos\/(?:web\/)?([^/?#]+)\.[a-z]+$/i.exec(url);
  if (!m || !HAVE_SMALL.has(m[2])) return url;
  return `${m[1]}logos/web/s/${m[2]}.webp`;
}
