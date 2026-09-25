// Download missing org logos from each org's website into public/logos/.
//
//   node scripts/fetch-logos.mjs            # uses scripts/logo-sources.json
//
// Runs in GitHub Actions (.github/workflows/fetch-logos.yml), which has open internet access.
// For each entry { id, website, logo_site?, logo_url? }:
//   - logo_url: download exactly this image (use to fix a wrong pick by hand)
//   - otherwise scan logo_site (or website) for, in order: a header <img> whose src/alt/class/id
//     mentions "logo", the apple-touch-icon, the largest <link rel=icon>, then /favicon.ico
// Also fills in the org's `website` in public/data.json when it's empty.
// Writes scripts/logo-report.json so a person can check what was picked.
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const sources = JSON.parse(readFileSync(`${ROOT}scripts/logo-sources.json`, "utf8"));
const dataPath = `${ROOT}public/data.json`;
const data = JSON.parse(readFileSync(dataPath, "utf8"));
const orgs = new Map(data.organizations.map((o) => [o.id, o]));
mkdirSync(`${ROOT}public/logos`, { recursive: true });

let sharp = null;
try { sharp = (await import("sharp")).default; } catch { /* optional: resize when available */ }

const UA = "Mozilla/5.0 (compatible; OpenthinkLogoBot/1.0; +https://github.com/nkessel/openthink_mycc)";
const get = (url, ms = 20000) =>
  fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" }, redirect: "follow", signal: AbortSignal.timeout(ms) });

const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : "";
};

function candidates(html, base) {
  const out = [];
  const abs = (u) => { try { return new URL(u.replace(/&amp;/g, "&"), base).href; } catch { return null; } };
  // 1. <img> mentioning "logo" (first few in the page, i.e. the header)
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const src = attr(tag, "src") || attr(tag, "data-src") || (attr(tag, "srcset").split(/\s+/)[0] ?? "");
    const hay = `${src} ${attr(tag, "alt")} ${attr(tag, "class")} ${attr(tag, "id")}`.toLowerCase();
    if (src && /logo/.test(hay) && !/data:/.test(src)) out.push({ how: "header <img> logo", url: abs(src) });
    if (out.length >= 2) break;
  }
  // Squarespace/Wix header logos often sit inside an element with "logo" in its class
  const wrap = /class="[^"]*logo[^"]*"[^>]*>\s*(?:<a[^>]*>\s*)?<img\b[^>]*>/i.exec(html);
  if (wrap) {
    const img = /<img\b[^>]*>/i.exec(wrap[0])[0];
    const src = attr(img, "src") || attr(img, "data-src");
    if (src) out.unshift({ how: "logo wrapper <img>", url: abs(src) });
  }
  // 2. apple-touch-icon, 3. largest icon
  const links = (html.match(/<link\b[^>]*>/gi) || []).map((t) => ({ rel: attr(t, "rel").toLowerCase(), href: attr(t, "href"), sizes: attr(t, "sizes") }));
  for (const l of links) if (l.rel.includes("apple-touch-icon") && l.href) out.push({ how: "apple-touch-icon", url: abs(l.href) });
  const icons = links.filter((l) => /\bicon\b/.test(l.rel) && l.href)
    .sort((a, b) => (parseInt(b.sizes) || 0) - (parseInt(a.sizes) || 0));
  for (const l of icons) out.push({ how: `icon ${l.sizes || ""}`.trim(), url: abs(l.href) });
  out.push({ how: "favicon.ico", url: abs("/favicon.ico") });
  return out.filter((c) => c.url);
}

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg", "image/webp": "webp", "image/gif": "gif", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico" };

async function download(url) {
  const res = await get(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  if (!type.startsWith("image/")) {
    // some servers send octet-stream; sniff
    if (buf.slice(0, 4).toString("hex") === "89504e47") type = "image/png";
    else if (buf.slice(0, 3).toString("hex") === "ffd8ff") type = "image/jpeg";
    else if (/^\s*(<\?xml|<svg)/.test(buf.slice(0, 200).toString())) type = "image/svg+xml";
    else if (buf.slice(0, 4).toString("hex") === "00000100") type = "image/x-icon";
    else throw new Error(`not an image (${type || "no type"})`);
  }
  if (buf.length < 200) throw new Error("too small");
  if (buf.length > 3_000_000) throw new Error("too large");
  return { buf, type };
}

const report = {};
for (const s of sources) {
  const org = orgs.get(s.id);
  if (!org) { report[s.id] = { error: "unknown org id" }; continue; }
  if (s.website && !org.website) org.website = s.website;
  if (org.logo && !s.logo_url && !s.force) { report[s.id] = { skipped: "already has a logo", logo: org.logo }; continue; }

  let picks = [];
  try {
    if (s.logo_url) picks = [{ how: "logo_url (set by hand)", url: s.logo_url }];
    else {
      const page = s.logo_site || s.website;
      const res = await get(page);
      picks = candidates(await res.text(), res.url || page);
    }
  } catch (e) {
    report[s.id] = { error: `couldn't load site: ${e.message}` };
    continue;
  }

  let done = false;
  const tried = [];
  for (const c of picks) {
    try {
      let { buf, type } = await download(c.url);
      let ext = EXT[type] || "png";
      if (sharp && ["png", "jpg", "webp", "gif"].includes(ext)) {
        const meta = await sharp(buf).metadata();
        if ((meta.width || 0) < 32 && (meta.height || 0) < 32) throw new Error(`too small (${meta.width}×${meta.height})`);
        buf = await sharp(buf).resize(256, 256, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
        ext = "png";
      }
      for (const old of ["png", "jpg", "svg", "webp", "gif", "ico"]) {
        const p = `${ROOT}public/logos/${s.id}.${old}`;
        if (old !== ext && existsSync(p)) unlinkSync(p);
      }
      writeFileSync(`${ROOT}public/logos/${s.id}.${ext}`, buf);
      org.logo = `logos/${s.id}.${ext}`;
      report[s.id] = { name: org.name, how: c.how, url: c.url, file: org.logo, bytes: buf.length, note: s.note };
      done = true;
      break;
    } catch (e) {
      tried.push(`${c.how}: ${e.message}`);
    }
  }
  if (!done) report[s.id] = { name: org.name, error: "no usable image", tried };
  console.log(s.id, "→", report[s.id].file || report[s.id].error);
}

writeFileSync(dataPath, JSON.stringify(data, null, 2) + "\n");
writeFileSync(`${ROOT}scripts/logo-report.json`, JSON.stringify(report, null, 2) + "\n");
const ok = Object.values(report).filter((r) => r.file).length;
console.log(`\n${ok}/${sources.length} logos saved. Details in scripts/logo-report.json`);
