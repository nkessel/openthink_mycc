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

// Nov 12: two much smaller copies from the same script, for the small bubbles of the first view: 32px
// (public/logos/web/t/), painted first, and 64px (public/logos/web/s/), swapped in when the browser is idle.
// The map moves a bubble up to the larger copy above only once it is big on screen.
import SMALL from "./logos.small.json";

const HAVE_SMALL = new Set<string>(SMALL as string[]);
export const TINY_LOGO_PX = 32;
export const SMALL_LOGO_PX = 64;

function sized(url: string | undefined, dir: "s" | "t"): string | undefined {
  if (!url) return url;
  const m = /^(\.?\/?)logos\/(?:web\/)?([^/?#]+)\.[a-z]+$/i.exec(url);
  if (!m || !HAVE_SMALL.has(m[2])) return url;
  return `${m[1]}logos/web/${dir}/${m[2]}.webp`;
}
/** "logos/x.png" or "logos/web/x.webp" → the 64px copy when there is one; anything else unchanged. */
export const smallLogo = (url: string | undefined) => sized(url, "s");
/** The same, for the 32px copy. */
export const tinyLogo = (url: string | undefined) => sized(url, "t");
