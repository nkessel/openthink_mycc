// Feedback button, always on the map (Nov 23, board 94): a small "Feedback" pill that opens "Send us a note", which
// goes straight to the Feedback tab of the sheet (apps-script/SignIn.gs, mapFeedback_). No sign-in, no Google Form.
// Drag it anywhere: it snaps to the nearest side and remembers the spot on this device. It starts beside the + button.
import { h } from "./dom";
import { api } from "./auth";
import { FORMS } from "./forms.config";

const STORE = "openthink.feedbackPos"; // { side: "left" | "right", y: fraction of the screen height }
type Pos = { side: "left" | "right"; y: number };
const ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>`;

let openPanel: ((from?: string) => void) | null = null;
/** Opens "Send us a note" (from the + menu or the note's "let us know" link). */
export function openFeedback(from = ""): boolean {
  if (!openPanel) return false;
  openPanel(from);
  return true;
}

export function createFeedbackButton(where: () => string): void {
  const btn = h("button", { type: "button", class: "fbk", "aria-haspopup": "dialog", "aria-expanded": "false", title: "Send feedback (drag to move)" }) as HTMLButtonElement;
  btn.innerHTML = `${ICON}<span>Feedback</span>`;
  document.body.appendChild(btn);

  let pos: Pos | null = null;
  try { pos = JSON.parse(localStorage.getItem(STORE) || "null"); } catch { /* private window */ }
  const place = () => {
    const bw = btn.offsetWidth, bh = btn.offsetHeight, W = innerWidth, H = innerHeight, m = 12;
    btn.style.left = btn.style.top = btn.style.right = btn.style.bottom = "";
    if (pos) {
      const y = Math.min(Math.max(pos.y * H, 70), H - bh - m);
      btn.style.top = `${y}px`;
      btn.style[pos.side] = `${m}px`;
      return;
    }
    // first visit: beside the + button (left of it when it sits at the bottom middle, above it in a corner)
    const fab = document.querySelector(".fab")?.getBoundingClientRect();
    if (fab && fab.width) {
      const corner = W - fab.right < 40;
      if (corner) { btn.style.right = `${W - fab.right}px`; btn.style.top = `${fab.top - bh - 12}px`; }
      else { btn.style.left = `${Math.max(m, fab.left - bw - 14)}px`; btn.style.top = `${fab.top + (fab.height - bh) / 2}px`; }
    } else { btn.style.right = `${m}px`; btn.style.bottom = `${m + 70}px`; }
  };
  requestAnimationFrame(() => { place(); btn.classList.add("in"); });
  addEventListener("resize", () => { place(); if (!panel.hidden) aim(); });
  // the + button settles after the map loads; follow it until the person moves this one
  for (const t of [600, 1800, 4000]) setTimeout(() => { if (!pos) place(); }, t);

  // ---- dragging (a press that moves more than a few pixels is a drag, not a click)
  let drag: { x: number; y: number; ox: number; oy: number; moved: boolean } | null = null;
  btn.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const r = btn.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, moved: false };
    btn.setPointerCapture(e.pointerId);
  });
  btn.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
    if (!drag.moved) { drag.moved = true; btn.classList.add("dragging"); close(); }
    btn.style.right = btn.style.bottom = "";
    btn.style.left = `${Math.min(Math.max(e.clientX - drag.ox, 0), innerWidth - btn.offsetWidth)}px`;
    btn.style.top = `${Math.min(Math.max(e.clientY - drag.oy, 0), innerHeight - btn.offsetHeight)}px`;
  });
  const drop = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    btn.classList.remove("dragging");
    if (!moved) return;
    const r = btn.getBoundingClientRect();
    pos = { side: r.left + r.width / 2 < innerWidth / 2 ? "left" : "right", y: r.top / innerHeight };
    try { localStorage.setItem(STORE, JSON.stringify(pos)); } catch { /* not kept: fine */ }
    btn.classList.add("snapping");
    place();
    setTimeout(() => btn.classList.remove("snapping"), 260);
    btn.dataset.dragged = "1";
  };
  btn.addEventListener("pointerup", drop);
  btn.addEventListener("pointercancel", drop);
  btn.addEventListener("click", () => {
    if (btn.dataset.dragged) { delete btn.dataset.dragged; return; }
    if (panel.hidden) show(); else close();
  });

  // ---- the panel
  const msg = h("textarea", { rows: "4", placeholder: "What's on your mind? An idea, a bug, a group we're missing…", "aria-label": "Your note" }) as HTMLTextAreaElement;
  const email = h("input", { type: "email", placeholder: "Your email (optional, if you'd like a reply)", autocomplete: "email", "aria-label": "Your email (optional)" }) as HTMLInputElement;
  const trap = h("input", { type: "text", name: "website", tabindex: "-1", autocomplete: "off", class: "fbk-trap", "aria-hidden": "true" }) as HTMLInputElement;
  const status = h("p", { class: "fbk-status", role: "status", "aria-live": "polite" });
  const send = h("button", { type: "button", class: "fbk-send" }, "Send") as HTMLButtonElement;
  const x = h("button", { type: "button", class: "fbk-x", "aria-label": "Close" }, "✕");
  const form = h("div", { class: "fbk-form" },
    h("h3", {}, "Send us a note"),
    h("p", { class: "fbk-sub" }, "Ideas, bugs, a group we're missing: it goes straight to the map team."),
    msg, email, trap, status,
    h("div", { class: "fbk-row" }, h("span", { class: "fbk-hint" }, "Read by a person"), send));
  const thanks = h("div", { class: "fbk-thanks", hidden: "" }, h("div", { class: "fbk-check", "aria-hidden": "true" }, "✓"), h("p", {}, "Thank you! Your note went straight to the map team."));
  const panel = h("div", { class: "fbk-panel", role: "dialog", "aria-label": "Send us a note", hidden: "" }, x, form, thanks);
  document.body.appendChild(panel);
  let from = "";

  function aim() {
    const r = btn.getBoundingClientRect(), W = innerWidth, H = innerHeight, m = 12;
    const pw = Math.min(340, W - 2 * m), ph = panel.offsetHeight || 300;
    const left = Math.min(Math.max(r.left + r.width / 2 < W / 2 ? r.left : r.right - pw, m), W - pw - m);
    const above = r.top - ph - 10 > m;
    panel.style.left = `${left}px`;
    panel.style.top = `${above ? r.top - ph - 10 : Math.min(r.bottom + 10, H - ph - m)}px`;
    panel.style.transformOrigin = `${r.left + r.width / 2 - left}px ${above ? "100%" : "0"}`;
  }
  function show(f = "") {
    from = f;
    form.hidden = false; thanks.hidden = true; status.textContent = "";
    panel.hidden = false; panel.classList.remove("closing");
    aim();
    btn.setAttribute("aria-expanded", "true");
    msg.focus();
  }
  function close() {
    if (panel.hidden || panel.classList.contains("closing")) return;
    btn.setAttribute("aria-expanded", "false");
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { panel.hidden = true; return; }
    panel.classList.add("closing");
    setTimeout(() => { panel.hidden = true; panel.classList.remove("closing"); }, 170);
  }
  openPanel = show;
  x.addEventListener("click", close);
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { close(); btn.focus(); } });
  document.addEventListener("pointerdown", (e) => { if (!panel.hidden && !panel.contains(e.target as Node) && !btn.contains(e.target as Node)) close(); });

  send.addEventListener("click", async () => {
    const text = msg.value.trim();
    if (!text) { status.textContent = "Please write a note first."; msg.focus(); return; }
    send.disabled = true;
    status.textContent = "Sending…";
    const page = [where(), from].filter(Boolean).join(" · ");
    const r = await api({ action: "feedback", message: text, email: email.value.trim(), website: trap.value, page });
    send.disabled = false;
    if (r.ok) {
      status.textContent = "";
      form.hidden = true; thanks.hidden = false;
      msg.value = "";
      setTimeout(close, 2600);
      return;
    }
    if (/reload the page/i.test(r.error || "") && FORMS.feedback.url) {
      // the sheet script hasn't been updated with the Feedback button yet: use the feedback form, note copied
      try { await navigator.clipboard.writeText(text); } catch { /* no clipboard */ }
      status.textContent = "Opening the feedback form; your note is copied, so you can paste it there.";
      window.open(FORMS.feedback.url, "_blank", "noopener");
      return;
    }
    status.textContent = r.error || "That didn't work. Please try again.";
  });
}
