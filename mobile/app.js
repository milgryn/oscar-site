// OSCAR Mobile : consultation de la boutique et actions à distance (application web installable).
//
// * Données : résumé chiffré déposé par le PC de la boutique sur le relais (Supabase), déchiffré ici.
// * Actions : chiffrées ici, déposées sur le relais, exécutées par le PC au nom du profil choisi (code PIN).
// * Le code d'appairage reste sur ce téléphone (stockage local) ; le relais ne voit que du chiffré.
import { decryptJson, deriveKeys, encryptJson, formatCode, normalizeCode } from "./oscar-crypto.js";

const APP_VERSION = "1.0.0";
const SUPABASE_URL = "https://yizxstpqeufbvasfhzai.supabase.co";
const SUPABASE_KEY = "sb_publishable_Nti6CAh_aFDSW8I-1m2uLA_DsJgsv5t";
const SITE_URL = "https://milgryn.github.io/oscar-site/";
const STALE_MINUTES = 30;

const $app = document.getElementById("app");
const $toast = document.getElementById("toast");

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const store = {
  get(k, d = null) { try { const v = localStorage.getItem("oscar." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("oscar." + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem("oscar." + k); } catch {} },
};

function toast(msg, ms = 3200) {
  $toast.textContent = msg;
  $toast.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $toast.classList.remove("show"), ms);
}

let currency = "EUR";
const money = (cents) => (cents == null ? "—" : new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(cents / 100));
const qty = (milli, unit) =>
  milli == null ? "—" : `${(milli / 1000).toLocaleString("fr-FR", { maximumFractionDigits: unit === "piece" ? 0 : 2 })} ${unit === "piece" ? "pce" : "kg"}`;
const day = (iso) => (iso ? new Date(iso + (iso.length === 10 ? "T12:00:00" : "")).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) : "");
function ago(iso) {
  if (!iso) return "jamais";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `le ${new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
}

const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  stock: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 12l9 4 9-4M3 17l9 4 9-4"/>',
  order: '<path d="M1 6h13v10H1zM14 10h4l3 3v3h-7"/><circle cx="5" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  loss: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  oscar: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
  refresh: '<path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
const LOGO = '<span class="logo" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4"><circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/></svg></span>';

// ---------------------------------------------------------------------------
// Relais
// ---------------------------------------------------------------------------

async function rpc(name, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`relais : ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------

const state = {
  keys: null,
  snap: store.get("snapshot"),
  snapAt: store.get("snapshotAt"),
  view: store.get("view", "home"),
  loading: false,
  offline: false,
  revoked: false,
  pending: store.get("pending", []),
  answer: store.get("answer"),
  picks: {},
};

async function pairWith(code) {
  const clean = normalizeCode(code);
  if (clean.length !== 32) throw new Error("Le code fait 32 caractères (8 groupes de 4).");
  const keys = await deriveKeys(clean);
  store.set("code", clean);
  state.keys = keys;
  state.snap = null;
  state.revoked = false;
  return keys;
}

async function refresh({ quiet = false } = {}) {
  if (!state.keys || state.loading) return;
  state.loading = true;
  renderTop();
  try {
    const rows = await rpc("oscar_get_snapshot", { p_channel: state.keys.channel });
    if (!rows || rows.length === 0) {
      state.offline = false;
      if (!state.snap) state.waiting = true;
    } else {
      try {
        const snap = await decryptJson(state.keys, rows[0].payload);
        state.snap = snap;
        state.snapAt = rows[0].updated_at;
        state.waiting = false;
        state.revoked = false;
        currency = snap.shop?.currency || "EUR";
        store.set("snapshot", snap);
        store.set("snapshotAt", rows[0].updated_at);
      } catch {
        state.revoked = true;
      }
      state.offline = false;
    }
  } catch {
    state.offline = true;
    if (!quiet) toast("Hors ligne : dernier résumé enregistré affiché.");
  } finally {
    state.loading = false;
    render();
  }
}

// ---------------------------------------------------------------------------
// Actions à distance
// ---------------------------------------------------------------------------

const ROLE = { patron: "Patron", responsable: "Responsable", chef_boucher: "Chef boucher", boucher: "Boucher", apprenti: "Apprenti", vendeur: "Vendeur" };

/** Feuille : choix du profil, motif éventuel, code PIN ; puis envoi chiffré. */
function askAction({ title, text, permission, reason, build, label }) {
  const team = (state.snap?.team || []).filter((p) => !permission || (p.permissions || []).includes(permission));
  const withPin = team.filter((p) => p.hasPin);
  let chosen = store.get("profile");
  if (!withPin.some((p) => p.id === chosen)) chosen = withPin[0]?.id ?? null;
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  bg.innerHTML = `<form class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <h2>${esc(title)}</h2>
    ${text ? `<p class="muted">${esc(text)}</p>` : ""}
    ${withPin.length === 0
      ? `<p class="err">Aucun profil autorisé n'a de code PIN. Sur le PC : Paramètres › Profils, définissez un code PIN pour agir depuis le téléphone.</p>`
      : `<div><p class="lbl" style="margin-bottom:6px">Qui êtes-vous ?</p><div class="profiles">${withPin
          .map((p) => `<button type="button" data-p="${esc(p.id)}" aria-pressed="${p.id === chosen}"><strong>${esc(p.name)}</strong><small>${esc(ROLE[p.role] || p.role)}</small></button>`)
          .join("")}</div></div>
      ${reason ? `<label class="lbl">Motif<input type="text" name="reason" required maxlength="200" placeholder="${esc(reason)}"></label>` : ""}
      <label class="lbl">Code PIN<input class="pin" type="password" name="pin" inputmode="numeric" autocomplete="off" pattern="[0-9]*" maxlength="8" required></label>`}
    <p class="err" data-err hidden></p>
    <div class="btns"><button type="button" class="btn btn-ghost" data-cancel>Annuler</button>${withPin.length ? `<button class="btn btn-primary" type="submit">Envoyer</button>` : ""}</div>
  </form>`;
  document.body.appendChild(bg);
  const form = bg.querySelector("form");
  const close = () => bg.remove();
  bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
  bg.querySelector("[data-cancel]").addEventListener("click", close);
  bg.querySelectorAll("[data-p]").forEach((b) =>
    b.addEventListener("click", () => {
      chosen = b.dataset.p;
      bg.querySelectorAll("[data-p]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    }),
  );
  setTimeout(() => form.querySelector("input[name=reason], input[name=pin]")?.focus(), 250);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = form.querySelector("[data-err]");
    const pin = form.pin.value.trim();
    const why = form.reason?.value.trim();
    if (!/^\d{4,8}$/.test(pin)) { err.hidden = false; err.textContent = "Le code PIN fait 4 à 8 chiffres."; return; }
    if (reason && !why) { err.hidden = false; err.textContent = "Indiquez un motif."; return; }
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Envoi…";
    try {
      const command = { ...build(why), profileId: chosen, pin, sentAt: new Date().toISOString() };
      const id = await rpc("oscar_push_command", { p_channel: state.keys.channel, p_payload: await encryptJson(state.keys, command) });
      store.set("profile", chosen);
      state.pending.push({ id, label, type: command.type, at: new Date().toISOString() });
      store.set("pending", state.pending);
      close();
      toast("Envoyé : en attente du PC de la boutique.");
      render();
      pollSoon();
    } catch {
      btn.disabled = false;
      btn.textContent = "Envoyer";
      err.hidden = false;
      err.textContent = "Envoi impossible : vérifiez la connexion Internet.";
    }
  });
}

let pollTimer = null;
function pollSoon() {
  clearTimeout(pollTimer);
  if (state.pending.length) pollTimer = setTimeout(poll, 4000);
}

async function poll() {
  if (!state.keys || !state.pending.length || document.hidden) return pollSoon();
  try {
    const rows = await rpc("oscar_get_commands", { p_channel: state.keys.channel, p_ids: state.pending.map((p) => p.id) });
    let changed = false;
    for (const row of rows || []) {
      if (row.status === "pending") continue;
      const p = state.pending.find((x) => x.id === row.id);
      let result = { ok: row.status === "done", message: row.status };
      try { if (row.result) result = await decryptJson(state.keys, row.result); } catch {}
      if (p?.type === "ask" && result.data) {
        state.answer = { question: p.label, answer: result.data, at: new Date().toISOString() };
        store.set("answer", state.answer);
      }
      toast(`${result.ok ? "✓" : "✗"} ${p?.label ?? "Action"} : ${result.message}`, 5000);
      state.pending = state.pending.filter((x) => x.id !== row.id);
      changed = true;
    }
    // Actions oubliées depuis plus de 3 jours : retirées de la liste.
    const before = state.pending.length;
    state.pending = state.pending.filter((p) => Date.now() - new Date(p.at).getTime() < 3 * 86400000);
    if (changed || before !== state.pending.length) {
      store.set("pending", state.pending);
      render();
      setTimeout(() => refresh({ quiet: true }), 2500);
    }
  } catch {}
  pollSoon();
}

// ---------------------------------------------------------------------------
// Écrans
// ---------------------------------------------------------------------------

const TABS = [
  ["home", "Accueil", "home"],
  ["stock", "Stocks", "stock"],
  ["orders", "Commandes", "order"],
  ["losses", "Pertes", "loss"],
  ["oscar", "Oscar", "oscar"],
];

function go(view) {
  state.view = view;
  store.set("view", view);
  render();
  scrollTo({ top: 0 });
}

function renderTop() {
  const top = document.querySelector(".top");
  if (!top) return;
  const stale = state.snapAt && Date.now() - new Date(state.snapAt).getTime() > STALE_MINUTES * 60000;
  top.querySelector(".fresh").innerHTML = state.snapAt
    ? `<span class="dot ${stale || state.offline ? "old" : ""}"></span>Boutique ${esc(ago(state.snapAt))}${state.offline ? " · hors ligne" : ""}`
    : "En attente du premier envoi";
  top.querySelector("[data-refresh]").classList.toggle("spin", state.loading);
}

function data(key) {
  const v = state.snap?.data?.[key];
  return v && !v.error ? v : null;
}

function viewHome() {
  const d = data("dashboard");
  const c = d?.commerce;
  const items = d?.briefing?.items || [];
  const anomalies = data("anomalies") || [];
  const prod = (data("production") || []).filter((p) => p.suggestedMilli > 0).slice(0, 6);
  const LV = { warning: ["warning", "!"], success: ["success", "✓"], info: ["info", "i"] };
  return `
    ${c ? `<div class="kpis">
      <div class="kpi hero"><span class="label">Chiffre d'affaires du jour</span><span class="value mono">${money(c.salesTodayCents)}</span><span class="sub">${c.ticketsToday} ticket(s) · hier ${money(c.salesYesterdayCents)}</span></div>
      <div class="kpi"><span class="label">CA du mois</span><span class="value mono">${money(c.salesMonthCents)}</span><span class="sub">panier moyen ${money(c.averageBasketMonthCents)}</span></div>
      <div class="kpi"><span class="label">Marge du mois</span><span class="value mono">${money(c.marginMonthCents)}</span><span class="sub">${c.marginMonthBp != null ? (c.marginMonthBp / 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " %" : ""}</span></div>
      <div class="kpi"><span class="label">Pertes du mois</span><span class="value mono">${money(c.lossesMonthCents)}</span><span class="sub">${c.pendingLosses} à valider</span></div>
      <div class="kpi"><span class="label">Affluence demain</span><span class="value mono">${d.trafficForecast?.valueMilli != null ? Math.round(d.trafficForecast.valueMilli / 1000) : "—"}</span><span class="sub">tickets prévus</span></div>
    </div>` : ""}
    <p class="section-title">Message d'Oscar</p>
    <div class="card">${items.length ? items.map((i) => `<div class="item"><span class="ic ${LV[i.level]?.[0] || "info"}">${LV[i.level]?.[1] || "i"}</span><div><strong>${esc(i.title)}</strong><p class="d">${esc(i.detail)}</p></div></div>`).join("") : `<p class="muted">Rien à signaler.</p>`}</div>
    ${prod.length ? `<p class="section-title">À préparer</p><div class="card">${prod.map((p) => `<div class="item"><span class="ic info">⚒</span><div><div class="row"><strong>${esc(p.productName)}</strong><span class="chip">${qty(p.suggestedMilli, p.unit)}</span></div><p class="d">${esc(p.recipeName)} · jusqu'au ${esc(day(p.until))}</p></div></div>`).join("")}</div>` : ""}
    ${anomalies.length ? `<p class="section-title">Points inhabituels</p><div class="card">${anomalies.slice(0, 6).map((a) => `<div class="item"><span class="ic ${a.severity === "high" ? "danger" : "warning"}">!</span><div><strong>${esc(a.title)}</strong><p class="d">${esc(a.explanation)}</p></div></div>`).join("")}</div>` : ""}`;
}

const ALERT = { expired: ["DLC dépassée", "danger"], expiring: ["DLC proche", "warn"], out: ["Rupture", "danger"], low: ["Sous le seuil", "warn"], over: ["Surstock", ""] };

function viewStock() {
  const alerts = data("stockAlerts") || [];
  const s = data("dashboard")?.stock;
  if (!alerts.length) return `${s ? stockSummary(s) : ""}<div class="card empty">Aucune alerte de stock ni de DLC.</div>`;
  const groups = Object.keys(ALERT).map((k) => [k, alerts.filter((a) => a.kind === k)]).filter(([, l]) => l.length);
  return `${s ? stockSummary(s) : ""}${groups
    .map(([k, list]) => `<p class="section-title">${ALERT[k][0]} (${list.length})</p><div class="card">${list
      .map((a) => `<div class="item"><span class="ic ${ALERT[k][1] === "danger" ? "danger" : ALERT[k][1] === "warn" ? "warning" : "info"}">${k === "expired" || k === "expiring" ? "⏱" : "▦"}</span><div><div class="row"><strong>${esc(a.productName)}</strong><span class="chip ${ALERT[k][1]}">${qty(a.qtyMilli, a.unit)}</span></div><p class="d">${a.lotNumber ? `Lot ${esc(a.lotNumber)}` : ""}${a.expiryDate ? ` · DLC ${esc(day(a.expiryDate))}${a.daysToExpiry != null ? ` (${a.daysToExpiry >= 0 ? "J-" + a.daysToExpiry : "dépassée"})` : ""}` : ""}${a.thresholdMilli != null ? ` · seuil ${qty(a.thresholdMilli, a.unit)}` : ""}</p></div></div>`)
      .join("")}</div>`)
    .join("")}`;
}

function stockSummary(s) {
  return `<div class="kpis"><div class="kpi"><span class="label">Valeur du stock</span><span class="value mono">${money(s.valueCents)}</span><span class="sub">${s.openLots} lots ouverts</span></div><div class="kpi"><span class="label">À surveiller</span><span class="value mono">${s.expiredLots + s.expiringLots + s.outProducts + s.lowProducts}</span><span class="sub">DLC, ruptures, seuils</span></div></div>`;
}

function stepFor(unit) {
  return unit === "piece" ? 1000 : 500;
}

function viewOrders() {
  const orders = (data("orders") || []).filter((o) => o.recommendationId && o.recommendationStatus === "pending" && o.suggestedMilli > 0);
  if (!orders.length) return `<div class="card empty">Aucune suggestion de commande en attente.</div>`;
  const bySupplier = {};
  for (const o of orders) (bySupplier[o.supplierName] ||= []).push(o);
  const picked = orders.filter((o) => state.picks[o.recommendationId]?.on);
  return `${Object.entries(bySupplier)
    .map(([sup, list]) => `<p class="section-title">${esc(sup)} · livraison ${esc(day(list[0].deliveryOn))}</p><div class="card">${list
      .map((o) => {
        const p = (state.picks[o.recommendationId] ||= { on: false, qty: o.suggestedMilli });
        return `<div class="item" style="grid-template-columns:minmax(0,1fr)"><label class="check"><input type="checkbox" data-pick="${esc(o.recommendationId)}" ${p.on ? "checked" : ""}><span><strong>${esc(o.productName)}</strong><span class="d" style="display:block">${esc(o.explanation)}</span></span></label>
          <div class="qty"><button type="button" data-minus="${esc(o.recommendationId)}" aria-label="Moins">−</button><input class="mono" type="text" inputmode="decimal" readonly value="${qty(p.qty, o.unit)}" aria-label="Quantité"><button type="button" data-plus="${esc(o.recommendationId)}" aria-label="Plus">+</button></div>
          <button type="button" class="btn btn-ghost" data-dismiss="${esc(o.recommendationId)}" data-name="${esc(o.productName)}">Écarter cette suggestion</button></div>`;
      })
      .join("")}</div>`)
    .join("")}
    <button class="btn btn-primary btn-block" data-create ${picked.length ? "" : "disabled"}>Créer ${picked.length || ""} brouillon(s) de commande</button>
    <p class="muted" style="font-size:13px">Les brouillons sont créés sur le PC ; vous les vérifiez et les passez au fournisseur depuis la boutique.</p>`;
}

const REASONS = { invendu: "Invendu", dlc_depassee: "DLC dépassée", surproduction: "Surproduction", deterioration: "Détérioration", erreur_preparation: "Erreur de préparation", erreur_decoupe: "Erreur de découpe", conservation: "Conservation", erreur_commande: "Erreur de commande", autre: "Autre" };

function viewLosses() {
  const page = data("pendingLosses");
  const list = page?.entries || [];
  if (!list.length) return `<div class="card empty">Aucune perte en attente de validation.</div>`;
  return `<p class="section-title">${list.length} perte(s) à valider</p>${list
    .map((l) => `<div class="card"><div class="row"><strong>${esc(l.productName)}</strong><span class="chip warn">${qty(l.qtyMilli, l.unit)}</span></div>
      <p class="d muted">${esc(REASONS[l.reason] || l.reason)} · lot ${esc(l.lotNumber)} · ${esc(day(l.declaredOn))}${l.declaredByName ? ` · par ${esc(l.declaredByName)}` : ""}</p>
      <p class="d">Valeur de vente perdue : <span class="mono">${money(l.potentialSaleCents)}</span>${l.costCents != null ? ` · coût <span class="mono">${money(l.costCents)}</span>` : ""}</p>
      ${l.comment ? `<p class="d muted">« ${esc(l.comment)} »</p>` : ""}
      <div class="btns"><button class="btn btn-danger" data-reject-loss="${esc(l.id)}" data-name="${esc(l.productName)}">Rejeter</button><button class="btn btn-primary" data-validate-loss="${esc(l.id)}" data-name="${esc(l.productName)}">Valider</button></div></div>`)
    .join("")}`;
}

const EXAMPLES = ["Qu'est-ce que je dois préparer demain ?", "Quels produits dois-je surveiller aujourd'hui ?", "Qu'ai-je vendu cette semaine ?", "Pourquoi mes pertes augmentent-elles ?", "Et si mon affluence augmente de 30 % ?"];

function viewOscar() {
  const a = state.answer;
  return `<div class="card"><label class="lbl">Votre question à Oscar<textarea id="q" rows="3" maxlength="500" placeholder="Ex. Combien de merguez dois-je produire samedi ?"></textarea></label>
    <div style="display:flex;flex-wrap:wrap;gap:6px">${EXAMPLES.map((e) => `<button type="button" class="chip ex" data-ex="${esc(e)}" style="border:0;cursor:pointer">${esc(e)}</button>`).join("")}</div>
    <button class="btn btn-primary" data-ask>Demander</button>
    <p class="muted" style="font-size:13px">La question part chiffrée vers le PC de la boutique, qui répond avec vos données (PC allumé, OSCAR ouvert).</p></div>
    ${a ? `<p class="section-title">Dernière réponse · ${esc(ago(a.at))}</p><div class="card answer"><p class="muted">« ${esc(a.question)} »</p><p><strong>${esc(a.answer.summary)}</strong></p>
      ${(a.answer.facts || []).map((f) => `<div class="row" style="align-items:flex-start"><span class="muted">${esc(f.label)}</span><span style="text-align:right">${esc(f.value)}</span></div>`).join("")}
      ${a.answer.table ? `<div class="scroll"><table><thead><tr>${a.answer.table.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${a.answer.table.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}
      ${a.answer.uncertainty ? `<p class="muted" style="font-size:13px">${esc(a.answer.uncertainty)}</p>` : ""}</div>` : ""}`;
}

function viewSettings() {
  const code = store.get("code", "");
  return `<p class="section-title">Ce téléphone</p>
    <div class="card"><p>Appairé à <strong>${esc(state.snap?.shop?.name || "votre boutique")}</strong>.</p><p class="muted mono" style="font-size:13px">Code : ${esc(formatCode(code).replace(/[A-Z2-7](?=.{4})/g, "•"))}</p>
    <button class="btn btn-ghost" data-unpair>Déconnecter ce téléphone</button></div>
    <p class="section-title">Aide</p>
    <div class="links"><a href="${SITE_URL}guide.html#mobile" target="_blank" rel="noopener">Guide d'utilisation <span>↗</span></a><a href="${SITE_URL}" target="_blank" rel="noopener">Site OSCAR <span>↗</span></a></div>
    <p class="section-title">Application</p>
    <div class="card"><p>OSCAR Mobile ${APP_VERSION}. Les mises à jour s'installent toutes seules à l'ouverture.</p><p class="muted" style="font-size:13px">Logiciel de la boutique : ${esc(state.snap?.appVersion || "—")}. Les données sont chiffrées : le service en ligne ne peut pas les lire.</p></div>`;
}

function render() {
  if (!state.keys) return renderPair();
  if (state.revoked) return renderRevoked();
  const views = { home: viewHome, stock: viewStock, orders: viewOrders, losses: viewLosses, oscar: viewOscar, settings: viewSettings };
  const body = !state.snap
    ? `<div class="card empty">${state.offline ? "Hors ligne : connectez-vous pour recevoir le premier résumé." : "En attente du premier envoi du PC de la boutique (OSCAR ouvert et connecté à Internet). Réessayez dans une minute."}</div>`
    : (views[state.view] || viewHome)();
  const lossesCount = data("pendingLosses")?.entries?.length || 0;
  const ordersCount = (data("orders") || []).filter((o) => o.recommendationId && o.recommendationStatus === "pending" && o.suggestedMilli > 0).length;
  $app.innerHTML = `
    <header class="top">${LOGO}<div class="titles"><h1>${esc(state.snap?.shop?.name || "OSCAR")}</h1><p class="fresh"></p></div>
      <button class="icon-btn" data-refresh aria-label="Actualiser">${icon("refresh")}</button>
      <button class="icon-btn" data-go="settings" aria-label="Réglages">${icon("gear")}</button></header>
    <main><div class="view">
      ${state.pending.length ? `<div class="card pending"><strong>${state.pending.length} action(s) en attente du PC de la boutique</strong>${state.pending.map((p) => `<span class="d muted">• ${esc(p.label)} · ${esc(ago(p.at))}</span>`).join("")}<span class="d muted">Le PC traite les actions toutes les 30 secondes quand OSCAR est ouvert.</span></div>` : ""}
      ${body}
    </div></main>
    <nav class="tabs" aria-label="Sections">${TABS.map(([id, label, ic]) => {
      const n = id === "losses" ? lossesCount : id === "orders" ? ordersCount : 0;
      return `<button data-go="${id}" ${state.view === id ? 'aria-current="page"' : ""}>${icon(ic)}<span>${label}</span>${n ? `<span class="badge">${n}</span>` : ""}</button>`;
    }).join("")}</nav>`;
  renderTop();
}

function renderPair(error = "") {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  $app.innerHTML = `<div class="pair"><div class="pair-box">
    ${LOGO}
    <h1>OSCAR <span>Mobile</span></h1>
    <p class="muted">Votre boucherie à distance : chiffres du jour, stocks et DLC, pertes à valider, commandes, questions à Oscar.</p>
    <ol class="steps"><li>Sur le PC de la boutique : Paramètres › Mobile › « Afficher l'appairage ».</li><li>Scannez le QR code avec l'appareil photo, ou saisissez le code ci-dessous.</li></ol>
    <form class="card" id="pair-form"><label class="lbl">Code d'appairage<input type="text" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD-EFGH-…" class="mono"></label>
      <p class="err" ${error ? "" : "hidden"}>${esc(error)}</p><button class="btn btn-primary" type="submit">Appairer ce téléphone</button></form>
    ${standalone ? "" : `<div class="install"><strong>Installez OSCAR sur l'écran d'accueil</strong><span><b>iPhone</b> : bouton Partager ⬆︎ puis « Sur l'écran d'accueil ».</span><span><b>Android</b> : menu ⋮ puis « Installer l'application ».</span><span>Sur iPhone, ouvrez ensuite OSCAR depuis l'écran d'accueil et saisissez le code une fois.</span></div>`}
    <p class="muted" style="font-size:13px">Les données sont chiffrées de bout en bout : seul un téléphone qui connaît ce code peut les lire.</p>
  </div></div>`;
  document.getElementById("pair-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await pairWith(e.target.code.value);
      render();
      refresh();
    } catch (err) {
      renderPair(err.message || "Code invalide.");
    }
  });
}

function renderRevoked() {
  $app.innerHTML = `<div class="pair"><div class="pair-box">${LOGO}<h1>Appairage <span>expiré</span></h1>
    <p class="muted">La boutique a créé un nouveau code d'appairage : ce téléphone n'a plus accès aux données. Saisissez le nouveau code.</p>
    <button class="btn btn-primary" data-reset>Saisir le nouveau code</button></div></div>`;
}

// ---------------------------------------------------------------------------
// Événements
// ---------------------------------------------------------------------------

$app.addEventListener("click", (e) => {
  const t = e.target.closest("button, [data-pick]");
  if (!t) return;
  const ds = t.dataset;
  if (ds.go) return go(ds.go);
  if ("refresh" in ds) return refresh();
  if ("reset" in ds || "unpair" in ds) {
    if ("unpair" in ds && !t.dataset.confirm) { t.dataset.confirm = "1"; t.textContent = "Confirmer la déconnexion"; return; }
    ["code", "snapshot", "snapshotAt", "pending", "answer"].forEach((k) => store.del(k));
    Object.assign(state, { keys: null, snap: null, snapAt: null, pending: [], answer: null, revoked: false });
    return render();
  }
  if (ds.minus || ds.plus) {
    const id = ds.minus || ds.plus;
    const o = (data("orders") || []).find((x) => x.recommendationId === id);
    const p = state.picks[id];
    p.qty = Math.max(0, p.qty + (ds.plus ? 1 : -1) * stepFor(o.unit));
    p.on = p.qty > 0;
    return render();
  }
  if (ds.dismiss) {
    return askAction({ title: "Écarter la suggestion", text: ds.name, reason: "Ex. stock suffisant, fermeture…", label: `Écarter ${ds.name}`, build: (why) => ({ type: "recommendation.reject", recommendationId: ds.dismiss, reason: why }) });
  }
  if ("create" in ds) {
    const picks = Object.entries(state.picks).filter(([, p]) => p.on && p.qty > 0).map(([id, p]) => ({ recommendationId: id, qtyMilli: p.qty }));
    if (!picks.length) return;
    return askAction({ title: "Créer les brouillons", text: `${picks.length} produit(s). Les brouillons seront créés sur le PC de la boutique.`, permission: "orders.manage", label: `Brouillons de commande (${picks.length})`, build: () => ({ type: "order.create", picks }) });
  }
  if (ds.validateLoss) {
    return askAction({ title: "Valider la perte", text: ds.name, permission: "losses.validate", label: `Valider la perte ${ds.name}`, build: () => ({ type: "loss.validate", lossId: ds.validateLoss }) });
  }
  if (ds.rejectLoss) {
    return askAction({ title: "Rejeter la perte", text: ds.name, permission: "losses.validate", reason: "Ex. quantité erronée", label: `Rejeter la perte ${ds.name}`, build: (why) => ({ type: "loss.reject", lossId: ds.rejectLoss, reason: why }) });
  }
  if (ds.ex) {
    const q = document.getElementById("q");
    q.value = ds.ex;
    return q.focus();
  }
  if ("ask" in ds) {
    const q = document.getElementById("q").value.trim();
    if (q.length < 3) return toast("Écrivez votre question.");
    return askAction({ title: "Question à Oscar", text: q, label: q, build: () => ({ type: "ask", question: q }) });
  }
});

$app.addEventListener("change", (e) => {
  const id = e.target.dataset?.pick;
  if (!id) return;
  state.picks[id].on = e.target.checked;
  render();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { refresh({ quiet: true }); poll(); }
});
setInterval(() => { if (!document.hidden) refresh({ quiet: true }); }, 60000);

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded || !navigator.serviceWorker.controller) return;
    reloaded = true;
  });
}

(async function start() {
  const m = location.hash.match(/pair=([A-Za-z0-9-]+)/);
  if (m) {
    history.replaceState(null, "", location.pathname + location.search);
    try { await pairWith(m[1]); toast("Téléphone appairé à la boutique."); } catch { return renderPair("Le lien d'appairage est invalide."); }
  } else {
    const code = store.get("code");
    if (code) { try { state.keys = await deriveKeys(code); } catch { store.del("code"); } }
  }
  if (state.snap) currency = state.snap.shop?.currency || "EUR";
  render();
  if (state.keys) { refresh({ quiet: true }); poll(); }
})();
