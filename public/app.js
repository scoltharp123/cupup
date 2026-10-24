/* CupUp — coffee hangs with your people. Plain JS, no build step. */
(() => {
"use strict";

/* ------------------------------------------------------------------ constants */
const COLORS = ["cherry", "matcha", "blueberry", "butter", "plum", "tangerine", "sky", "espresso"];
const VIBES = ["Catch-up", "Walk & talk", "Laptop session", "Pastry run", "Morning slow", "Big news"];
const ORDERS = ["Oat cortado", "Drip, black", "Iced latte", "Chai latte", "Americano", "Mocha"];
const TITLES = ["Saturday cortados", "Coffee before work", "Quick catch-up", "Laptops + lattes", "Walk & sip"];
const SPOT_INFO = {
  york: { name: "Thump York", sub: "Thump Coffee" },
  grove: { name: "Thump Grove", sub: "Thump Coffee" },
  house: { name: "Someone's place", sub: "House hang" },
};
const KEY = "cupup_v1";
const $ = (s, el = document) => el.querySelector(s);

/* ------------------------------------------------------------------ state */
let S = load();
let UI = { tab: "hangs", sheet: null, flash: null, busy: false };
let config = { email: false };

function load() {
  try { return Object.assign({ token: null, user: null, crews: [], current: null, crew: null }, JSON.parse(localStorage.getItem(KEY)) || {}); }
  catch { return { token: null, user: null, crews: [], current: null, crew: null }; }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} }

/* ------------------------------------------------------------------ helpers */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "Friend";
const initials = (n) => { const w = String(n || "?").trim().split(/\s+/); return ((w[0] || "?")[0] + (w[1] ? w[1][0] : "")).toUpperCase(); };
const colorOf = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % 7]; };
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const atOf = (h) => new Date(`${h.date}T${h.time}:00`);
function fmtTime(t) { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}${m ? ":" + pad(m) : ""} ${h < 12 ? "am" : "pm"}`; }
function dayWord(date) {
  const today = ymd(new Date()), tmrw = ymd(addDays(new Date(), 1));
  const d = new Date(date + "T12:00:00");
  if (date === today) return "Today";
  if (date === tmrw) return "Tomorrow";
  const diff = Math.round((d - new Date(today + "T12:00:00")) / 86400000);
  if (diff > 0 && diff < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function untilWord(h) {
  const ms = atOf(h) - Date.now();
  if (ms < 0) return "Happening now";
  const hrs = ms / 3600000;
  if (hrs < 1) return `In ${Math.max(1, Math.round(ms / 60000))} min`;
  if (hrs < 20) return `In ${Math.round(hrs)} hr`;
  const days = Math.round((new Date(h.date + "T12:00:00") - new Date(ymd(new Date()) + "T12:00:00")) / 86400000);
  return days === 1 ? "Tomorrow" : `In ${days} days`;
}
const member = (id) => S.crew?.members.find((m) => m.id === id);
function spotLine(h) {
  if (h.spot.kind === "house") {
    if (h.spot.houseOf === S.user?.id) return "Your place";
    const m = member(h.spot.houseOf);
    return m ? `${first(m.name)}'s place` : "Someone's place";
  }
  return SPOT_INFO[h.spot.kind].name;
}
const upcoming = () => (S.crew?.hangs || []).filter((h) => atOf(h).getTime() > Date.now() - 2 * 3600000).sort((a, b) => atOf(a) - atOf(b));
function av(m, size = "") {
  if (!m) return "";
  return `<span class="av ${size} c-${esc(m.color || "espresso")}" title="${esc(m.name)}">${esc(initials(m.name))}</span>`;
}
const isMobile = () => /iphone|ipad|android/i.test(navigator.userAgent);

let tt;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), 2600);
}

/* ------------------------------------------------------------------ api */
async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  if (S.token) headers.Authorization = `Bearer ${S.token}`;
  if (body) headers["Content-Type"] = "application/json";
  let res;
  try { res = await fetch(`/api/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store" }); }
  catch { throw new Error("You look offline. Check your connection and try again."); }
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && S.token) { signOutLocal(); throw new Error("You were signed out. Sign back in to keep going."); }
  if (!res.ok) { const e = new Error(data.error || "Something went wrong. Try again."); e.status = res.status; throw e; }
  return data;
}
function setCrew(g) {
  S.crew = g; S.current = g.code;
  const i = S.crews.findIndex((c) => c.code === g.code);
  const row = { code: g.code, name: g.name, memberCount: g.members.length };
  if (i < 0) S.crews.push(row); else S.crews[i] = row;
  save();
}
function signOutLocal() { S = { token: null, user: null, crews: [], current: null, crew: null }; save(); }

async function refreshMe() {
  const d = await api("me");
  S.user = d.user; S.crews = d.crews;
  if (!S.crews.find((c) => c.code === S.current)) { S.current = S.crews[0]?.code || null; S.crew = null; }
  save();
}
async function refreshCrew() {
  if (!S.current) return;
  try {
    const d = await api(`crew/${S.current}`);
    if (d.crew) setCrew(d.crew);
  } catch (e) {
    if (e.status === 404 || e.status === 403) { S.crews = S.crews.filter((c) => c.code !== S.current); S.current = S.crews[0]?.code || null; S.crew = null; save(); if (S.current) return refreshCrew(); }
    else throw e;
  }
}

/* ------------------------------------------------------------------ art */
const steam = `<svg class="steam" viewBox="0 0 40 44" aria-hidden="true"><path d="M10 40c-5-7 5-11 0-18"/><path d="M20 40c-5-7 5-11 0-18"/><path d="M30 40c-5-7 5-11 0-18"/></svg>`;
function cups(list = ["cherry", "butter", "matcha", "blueberry", "plum"], heights = [92, 70, 110, 80, 64]) {
  return `<div class="cups" aria-hidden="true">${list.map((c, i) => `<div class="cup c-${c}" style="height:${heights[i % heights.length]}px;background:currentColor">${i === 2 ? steam : ""}</div>`).join("")}</div>`;
}
const ICONS = {
  cup: `<svg viewBox="0 0 36 36" aria-hidden="true"><path d="M7 13h18v9a8 8 0 0 1-8 8h-2a8 8 0 0 1-8-8z" fill="currentColor"/><path d="M25 16h2.5a3.5 3.5 0 0 1 0 7H25" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M12 9c-1.5-2 1.5-3 0-5M18 9c-1.5-2 1.5-3 0-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
  cupTall: `<svg viewBox="0 0 36 36" aria-hidden="true"><path d="M9 8h16l-2 22H11z" fill="currentColor"/><rect x="8" y="5" width="18" height="4" rx="2" fill="currentColor"/><path d="M10.5 15h13" stroke="var(--bg)" stroke-width="2.4" opacity=".6"/></svg>`,
  house: `<svg viewBox="0 0 36 36" aria-hidden="true"><path d="M5 17L18 6l13 11v13H5z" fill="currentColor"/><rect x="15" y="21" width="6" height="9" fill="var(--bg)" opacity=".65"/></svg>`,
  hangs: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 5.5c-.8-1 .8-1.6 0-2.6M12 5.5c-.8-1 .8-1.6 0-2.6"/></svg>`,
  crew: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 19c.6-3.3 3-5 6-5s5.4 1.7 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14c2.6 0 4.4 1.4 5 4"/></svg>`,
  you: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.8-3.8 3.7-5.8 7.5-5.8s6.7 2 7.5 5.8"/></svg>`,
  heroCup: `<svg class="art" viewBox="0 0 150 150" aria-hidden="true"><path d="M30 60h70v32a30 30 0 0 1-30 30h-10a30 30 0 0 1-30-30z"/><path d="M100 70h10a14 14 0 0 1 0 28h-10"/><path d="M52 44c-6-8 6-12 0-20M74 44c-6-8 6-12 0-20"/></svg>`,
};
const chev = `<svg class="chev" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

/* ------------------------------------------------------------------ screens */
function render() {
  const app = $("#app");
  if (!S.token || !S.user) app.innerHTML = UI.pending ? joinWelcome() : landing();
  else if (UI.pending) app.innerHTML = joinConfirm();
  else if (!S.current || !S.crew) app.innerHTML = noCrew();
  else app.innerHTML = shell();
  renderSheet();
  if (UI.flash) {
    const el = document.getElementById(`h-${UI.flash}`);
    if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("flash"); }
    UI.flash = null;
  }
}

function landing() {
  return `<div class="wrap"><div class="landing">
    <div class="top" style="position:static"><span class="wordmark"><span class="bean"></span>CupUp</span>
      <button class="btn ghost sm" data-act="signin-sheet">Sign in</button></div>
    ${cups()}
    <div style="display:flex;flex-direction:column;gap:14px">
      <h1 class="h-xl">Coffee's better with your people.</h1>
      <p class="lede">Pick a spot, pick a time, and see who's in. No more group-text shuffle.</p>
    </div>
    <ul class="points">
      <li><span class="dot c-cherry"></span><div><b>Start a hang in seconds</b><span class="muted small">Thump York, Thump Grove, or someone's kitchen.</span></div></li>
      <li><span class="dot c-matcha"></span><div><b>Invite your crew with one link</b><span class="muted small">Friends tap it, add their name, and they're in.</span></div></li>
      <li><span class="dot c-butter"></span><div><b>Know everyone's order</b><span class="muted small">First one there grabs the round.</span></div></li>
    </ul>
    <button class="btn cherry lg block" data-act="onboard">Get started</button>
  </div></div>`;
}

function joinWelcome() {
  const p = UI.pending.preview;
  if (!p) return `<div class="wrap"><div class="boot"><span class="bean big"></span></div></div>`;
  return `<div class="wrap"><div class="landing">
    <div class="top" style="position:static"><span class="wordmark"><span class="bean"></span>CupUp</span>
      <button class="btn ghost sm" data-act="signin-sheet">Sign in</button></div>
    <div class="invite-card">
      <span class="label">${p.invitedBy ? `${esc(p.invitedBy)} invited you` : "You're invited"}</span>
      <h1 class="h-lg">${esc(p.name)}</h1>
      <div class="who"><div class="stack">${p.members.slice(0, 6).map((m) => av(m)).join("")}</div>
        <span class="count">${p.memberCount} ${p.memberCount === 1 ? "person" : "people"}${p.upcoming ? ` · ${p.upcoming} hang${p.upcoming === 1 ? "" : "s"} coming up` : ""}</span></div>
    </div>
    ${cups(["butter", "cherry", "matcha"], [70, 96, 80])}
    <p class="lede">Add your name and your usual order, and you're in.</p>
    <button class="btn cherry lg block" data-act="onboard">Join the crew</button>
  </div></div>`;
}

function joinConfirm() {
  const p = UI.pending.preview;
  if (!p) return `<div class="wrap"><div class="boot"><span class="bean big"></span></div></div>`;
  return `<div class="wrap"><div class="landing">
    <div class="top" style="position:static"><span class="wordmark"><span class="bean"></span>CupUp</span></div>
    <div class="invite-card">
      <span class="label">${p.invitedBy ? `${esc(p.invitedBy)} invited you` : "You're invited"}</span>
      <h1 class="h-lg">${esc(p.name)}</h1>
      <div class="who"><div class="stack">${p.members.slice(0, 6).map((m) => av(m)).join("")}</div>
        <span class="count">${p.memberCount} ${p.memberCount === 1 ? "person" : "people"}</span></div>
      <button class="btn cherry lg block" data-act="join" ${UI.busy ? "disabled" : ""}>Join ${esc(p.name)}</button>
      <button class="btn ghost block" data-act="skip-join">Not now</button>
    </div>
  </div></div>`;
}

function noCrew() {
  return `<div class="wrap"><div class="landing">
    <div class="top" style="position:static"><span class="wordmark"><span class="bean"></span>CupUp</span>
      <button class="btn ghost sm" data-act="signout-sheet">Sign out</button></div>
    <div style="display:flex;flex-direction:column;gap:12px">
      <span class="label">Hey ${esc(first(S.user.name))}</span>
      <h1 class="h-lg">Start your coffee crew.</h1>
      <p class="lede">A crew is your group of friends. Start one, then send the invite link to the group chat.</p>
    </div>
    <form class="form" data-form="crew">
      <div class="field"><label class="label" for="crew-name">Crew name</label>
        <input class="input" id="crew-name" name="name" maxlength="40" required placeholder="Bend Coffee Crew" autocomplete="off"></div>
      <p class="err" id="crew-err" hidden></p>
      <button class="btn cherry lg block" type="submit">Start crew</button>
    </form>
    <div class="card">
      <b>Got an invite link instead?</b>
      <span class="muted small">Just open it, or paste it here.</span>
      <form class="form" data-form="paste" style="gap:10px">
        <input class="input" id="paste-link" name="link" placeholder="cupup-coffee.netlify.app/join/…" autocomplete="off">
        <button class="btn soft block" type="submit">Join from link</button>
      </form>
    </div>
  </div></div>`;
}

function shell() {
  const tabs = [["hangs", "Hangs", ICONS.hangs], ["crew", "Crew", ICONS.crew], ["you", "You", ICONS.you]];
  return `<div class="wrap">
    <header class="top">
      <button class="crew-pill" data-act="crews-sheet" aria-label="Switch crew"><span class="bean" style="width:12px;height:16px"></span><span>${esc(S.crew.name)}</span>${chev}</button>
      <button class="btn soft sm" data-act="invite-sheet">Invite</button>
    </header>
    ${UI.tab === "hangs" ? (UI.hang ? detailView() : hangsView()) : UI.tab === "crew" ? crewView() : youView()}
  </div>
  ${UI.tab === "hangs" && !UI.hang ? `<button class="btn cherry lg fab" data-act="new-hang">+ Start a hang</button>` : ""}
  <nav class="tabs" aria-label="Sections"><div class="row">
    ${tabs.map(([k, l, i]) => `<button data-tab="${k}" ${UI.tab === k ? 'aria-current="page"' : ""}>${i}${l}</button>`).join("")}
  </div></nav>`;
}

/* ---------- hang helpers ---------- */
const PLACES = {
  york: { name: "Thump York", addr: "549 NW York Dr, Suite 200, Bend, OR 97703", hours: { 0: ["07:00", "17:00"], 6: ["07:00", "17:30"], d: ["06:30", "17:30"] } },
  grove: { name: "Thump Grove", addr: "921 NW Mount Washington Dr, Bend, OR 97703", hours: { d: ["06:30", "17:00"] } },
};
const isHost = (h) => h.hostId === S.user.id;
const myStatus = (h) => (isHost(h) ? "host" : h.going.includes(S.user.id) ? "going" : h.maybe.includes(S.user.id) ? "maybe" : h.declined.includes(S.user.id) ? "cant" : "");
const noReply = (h) => S.crew.members.filter((m) => m.id !== h.hostId && !h.going.includes(m.id) && !h.maybe.includes(m.id) && !h.declined.includes(m.id));
const hangById = (id) => S.crew?.hangs.find((h) => h.id === id);
function hoursNote(h) {
  const p = PLACES[h.spot.kind];
  if (!p) return "";
  const dow = new Date(h.date + "T12:00:00").getDay();
  const [open, close] = p.hours[dow] || p.hours.d;
  if (h.time < open) return `Heads up: ${p.name} opens at ${fmtTime(open)} that day.`;
  if (h.time >= close) return `Heads up: ${p.name} closes at ${fmtTime(close)} that day.`;
  const [ch, cm] = close.split(":").map(Number), [th, tm] = h.time.split(":").map(Number);
  if (ch * 60 + cm - (th * 60 + tm) < 45) return `Heads up: ${p.name} closes at ${fmtTime(close)}.`;
  return "";
}
function mapsUrl(addr) {
  const q = encodeURIComponent(addr);
  return /iphone|ipad|macintosh/i.test(navigator.userAgent) ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}
function placeAddr(h) {
  if (PLACES[h.spot.kind]) return PLACES[h.spot.kind].addr;
  return member(h.spot.houseOf)?.home?.address || "";
}
function orderTally(ids) {
  const groups = new Map();
  for (const id of ids) {
    const m = member(id);
    if (!m) continue;
    const key = (m.order || "").trim() || "No usual set";
    const k = key.toLowerCase();
    if (!groups.has(k)) groups.set(k, { order: key, people: [] });
    groups.get(k).people.push(m.id === S.user.id ? "you" : first(m.name));
  }
  return [...groups.values()].sort((a, b) => b.people.length - a.people.length || (a.order === "No usual set") - (b.order === "No usual set"));
}
const dayOf = (h) => { const ms = atOf(h) - Date.now(); return ms < 3 * 3600000 && ms > -2 * 3600000; };
const recentChange = (h) => h.changed && Date.now() - Date.parse(h.changed.at) < 4 * 86400000 && !isHost(h);
function changedText(h) {
  const f = h.changed.fields;
  const bits = [];
  if (f.includes("date") || f.includes("time")) bits.push(`now ${dayWord(h.date)} at ${fmtTime(h.time)}`);
  if (f.includes("spot")) bits.push(`now at ${spotLine(h)}`);
  return `Updated: ${bits.join(", ")}`;
}
function relTime(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/* ---------- status + who ---------- */
function rsvpRow(h, compact) {
  const st = myStatus(h);
  if (st === "host") return "";
  const full = h.cap && h.going.length >= h.cap && st !== "going";
  return `<div class="rsvp ${compact ? "compact" : ""}">
    <button class="going" aria-pressed="${st === "going"}" data-rsvp="going" data-id="${h.id}" ${full ? "disabled" : ""}>${st === "going" ? "You're in" : full ? "Full" : "I'm in"}</button>
    <button class="maybe" aria-pressed="${st === "maybe"}" data-rsvp="maybe" data-id="${h.id}">Maybe</button>
    <button class="cant" aria-pressed="${st === "cant"}" data-rsvp="cant" data-id="${h.id}">Can't</button>
  </div>`;
}
function countLine(h) {
  const parts = [`${h.going.length}${h.cap ? `/${h.cap}` : ""} in`];
  if (h.maybe.length) parts.push(`${h.maybe.length} maybe`);
  if (isHost(h)) { const n = noReply(h).length; if (n) parts.push(`${n} no reply`); }
  return parts.join(" · ");
}
function stackOf(ids, n = 5) { return `<div class="stack">${ids.map(member).filter(Boolean).slice(0, n).map((m) => av(m)).join("")}</div>`; }
function statusTag(h) {
  const st = myStatus(h);
  return st === "host" ? `<span class="pill host">Hosting</span>` : st === "going" ? `<span class="pill in">You're in</span>` : st === "maybe" ? `<span class="pill maybe">Maybe</span>` : st === "cant" ? `<span class="pill out">Can't</span>` : `<span class="pill ask">Reply</span>`;
}

/* ---------- cards ---------- */
function heroCard(h) {
  const c = colorOf(h.id);
  const host = member(h.hostId);
  return `<article class="hero c-${c}" id="h-${h.id}" data-open="${h.id}" tabindex="0" role="button" aria-label="Open ${esc(h.title)}">
    ${ICONS.heroCup}
    <span class="eyebrow">${isHost(h) ? "You're hosting" : "Your next hang"} · ${esc(untilWord(h))}</span>
    <h2>${esc(h.title)}</h2>
    <div class="when">${esc(dayWord(h.date))} · ${fmtTime(h.time)}</div>
    <div class="where">${esc(spotLine(h))}${isHost(h) ? "" : ` · with ${esc(first(host?.name))}`}</div>
    ${recentChange(h) ? `<div class="changed">${esc(changedText(h))}</div>` : ""}
    <div class="row">${stackOf(h.going, 6)}<span class="count">${countLine(h)}</span></div>
    <div class="row hero-cta"><span class="open-cta">${isHost(h) ? "Manage hang" : "See details"} →</span>${h.comments.length ? `<span class="count">${h.comments.length} message${h.comments.length === 1 ? "" : "s"}</span>` : ""}</div>
  </article>`;
}
function hangCard(h, { ask } = {}) {
  const c = colorOf(h.id);
  const d = new Date(h.date + "T12:00:00");
  const host = member(h.hostId);
  return `<article class="hang ${myStatus(h) === "cant" ? "dim" : ""}" id="h-${h.id}">
    <button class="sleeve c-${c}" data-open="${h.id}" aria-label="Open ${esc(h.title)}"><span class="dow">${d.toLocaleDateString("en-US", { weekday: "short" })}</span><span class="d">${d.getDate()}</span><span class="m">${d.toLocaleDateString("en-US", { month: "short" })}</span></button>
    <div class="body">
      <button class="hang-link" data-open="${h.id}">
        <span class="title">${esc(h.title)}</span>
        <span class="meta"><b>${fmtTime(h.time)}</b> · ${esc(spotLine(h))}${h.spot.houseOf === h.hostId ? "" : ` · ${isHost(h) ? "you're hosting" : `${esc(first(host?.name))} hosting`}`}</span>
      </button>
      ${recentChange(h) ? `<div class="changed small-chg">${esc(changedText(h))}</div>` : ""}
      <div class="who">${stackOf(h.going)}<span class="count">${countLine(h)}</span>${ask ? "" : statusTag(h)}</div>
      ${ask ? rsvpRow(h, true) : ""}
    </div>
  </article>`;
}

/* ---------- home ---------- */
function feedText(ev) {
  const who = ev.actor === S.user.id ? "You" : first(member(ev.actor)?.name || "Someone");
  const h = ev.hangId ? hangById(ev.hangId) : null;
  const t = h ? h.title : ev.title || "a hang";
  switch (ev.type) {
    case "join": return `${who} joined the crew`;
    case "hang": return `${who} started ${t}`;
    case "in": return `${who} is in for ${t}`;
    case "out": return `${who} can't make ${t} now`;
    case "edit": return h ? `${who} changed ${t}: ${dayWord(h.date)} at ${fmtTime(h.time)}, ${spotLine(h)}` : `${who} changed a hang`;
    case "cancel": return `${who} cancelled ${t}`;
    case "comment": return `${who} on ${t}: “${ev.text}”`;
    default: return "";
  }
}
function newsStrip() {
  const seen = (S.seen || {})[S.crew.code] || S.crew.members.find((m) => m.id === S.user.id)?.joinedAt || "";
  const evs = (S.crew.feed || []).filter((e) => e.actor !== S.user.id && e.at > seen && (!e.hangId || hangById(e.hangId))).slice(-4).reverse();
  if (!evs.length) return "";
  return `<section class="news" aria-label="What's new"><div class="news-head"><span class="label">New since you last looked</span><button class="linkbtn small" data-act="seen">Clear</button></div>
    ${evs.map((e) => `<button class="news-row" ${e.hangId ? `data-open="${e.hangId}"` : ""}>${av(member(e.actor))}<span>${esc(feedText(e))}</span><span class="muted small">${relTime(e.at)}</span></button>`).join("")}</section>`;
}
function hangsView() {
  const list = upcoming();
  if (!list.length) {
    return `<div class="spacer"></div>${newsStrip()}<div class="empty">
      ${cups(["butter", "cherry", "matcha"], [56, 80, 66])}
      <h2 class="h-lg">Nothing on the calendar.</h2>
      <p class="lede">${S.crew.members.length < 2 ? "Invite a few friends, then start the first hang." : "Start a hang and see who's free."}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn cherry" data-act="new-hang">Start a hang</button>
        ${S.crew.members.length < 2 ? `<button class="btn soft" data-act="invite-sheet">Invite friends</button>` : ""}
      </div>
    </div>`;
  }
  const ask = list.filter((h) => myStatus(h) === "");
  const mine = list.filter((h) => ["host", "going"].includes(myStatus(h)));
  const next = mine[0];
  const rest = list.filter((h) => h !== next && !ask.includes(h));
  return `<div class="spacer"></div>${newsStrip()}
    ${ask.length ? `<div class="section-head"><h2 class="h-md">Waiting on your answer</h2><span class="label">${ask.length}</span></div><div class="list">${ask.map((h) => hangCard(h, { ask: true })).join("")}</div>` : ""}
    ${next ? `<div class="section-head"><h2 class="h-md">${isHost(next) ? "You're hosting next" : "You're going next"}</h2></div>${heroCard(next)}` : ""}
    ${rest.length ? `<div class="section-head"><h2 class="h-md">Also coming up</h2><span class="label">${rest.length}</span></div><div class="list">${rest.map((h) => hangCard(h)).join("")}</div>` : ""}
    <p class="foot">Hangs disappear a couple of hours after they start.</p>`;
}

/* ---------- hang detail ---------- */
function peopleList(ids, label, withOrder) {
  if (!ids.length) return "";
  return `<div class="plist"><span class="label">${label} · ${ids.length}</span>${ids.map(member).filter(Boolean).map((m) => `<div class="prow">${av(m)}<span class="pname">${m.id === S.user.id ? "You" : esc(m.name)}</span>${withOrder ? `<span class="porder">${esc(m.order || "")}</span>` : ""}</div>`).join("")}</div>`;
}
function detailView() {
  const h = hangById(UI.hang);
  if (!h) { UI.hang = null; return hangsView(); }
  const c = colorOf(h.id);
  const host = member(h.hostId);
  const st = myStatus(h);
  const addr = placeAddr(h);
  const isHouse = h.spot.kind === "house";
  const houseOwner = isHouse ? member(h.spot.houseOf) : null;
  const tally = orderTally(h.going);
  const waiting = noReply(h);
  const hn = hoursNote(h);
  const quick = dayOf(h) ? ["On my way", "Running 5 late", "Grabbed a table", "Here!"] : ["Can't wait", "Who's driving?", "Want a pastry?"];
  return `<div class="detail">
    <button class="btn ghost sm back" data-act="back">← All hangs</button>
    <header class="dhead c-${c}">
      ${ICONS.heroCup}
      <span class="eyebrow">${esc(untilWord(h))} · ${esc(h.vibe)}</span>
      <h1>${esc(h.title)}</h1>
      <div class="when">${esc(dayWord(h.date))} · ${fmtTime(h.time)}</div>
      <div class="where">${esc(spotLine(h))}</div>
      <div class="by">${av(host)}<span>${isHost(h) ? "You're hosting" : `Hosted by ${esc(host?.name || "a friend")}`}</span></div>
    </header>
    ${recentChange(h) ? `<div class="banner">${esc(changedText(h))}</div>` : ""}

    ${st === "host" ? hostPanel(h, tally, waiting) : `
    <section class="block">
      <span class="label">Are you in?</span>
      ${rsvpRow(h)}
      ${h.cap ? `<span class="muted small">Room for ${h.cap}. ${Math.max(0, h.cap - h.going.length)} spot${h.cap - h.going.length === 1 ? "" : "s"} left.</span>` : ""}
    </section>`}

    <section class="block">
      <span class="label">Where</span>
      <div class="place">
        <div><b>${esc(spotLine(h))}</b>${addr ? `<div class="muted small sel">${esc(addr)}</div>` : ""}
          ${isHouse && houseOwner?.home?.note ? `<div class="small">${esc(houseOwner.home.note)}</div>` : ""}
          ${isHouse && !addr ? (h.spot.houseOf === S.user.id ? `<div class="small muted">Add your address so the crew can find you.</div>` : `<div class="small muted">${esc(first(houseOwner?.name))} hasn't added an address. Ask in the chat below.</div>`) : ""}
        </div>
      </div>
      ${hn ? `<div class="warn">${esc(hn)}</div>` : ""}
      <div class="btnrow">
        ${addr ? `<a class="btn soft sm" href="${mapsUrl(addr)}" target="_blank" rel="noopener">Directions</a>` : isHouse && h.spot.houseOf === S.user.id ? `<button class="btn soft sm" data-act="home-sheet">Add my address</button>` : ""}
        <a class="btn soft sm" href="/api/crew/${S.crew.code}/hang/${h.id}.ics">Add to calendar</a>
        <button class="btn soft sm" data-act="share-hang" data-id="${h.id}">Share</button>
      </div>
      ${h.note ? `<div class="note">${esc(h.note)}</div>` : ""}
    </section>

    ${st !== "host" ? `<section class="block">
      <span class="label">Who's coming</span>
      ${peopleList(h.going, "In", true)}
      ${peopleList(h.maybe, "Maybe")}
      ${peopleList(h.declined, "Can't make it")}
      ${tally.length && st === "going" && !isHouse ? `<div class="tally"><span class="label">If you're first there, the order is</span>${tally.map((t) => `<div class="trow"><b>${t.people.length}×</b><span>${esc(t.order)}</span><span class="muted small">${esc(t.people.join(", "))}</span></div>`).join("")}</div>` : ""}
    </section>` : ""}

    ${isHouse ? bringBlock(h) : ""}

    <section class="block">
      <span class="label">Chat</span>
      <div class="chat">${h.comments.length ? h.comments.map((m) => { const who = member(m.by); const mine = m.by === S.user.id; return `<div class="msg ${mine ? "mine" : ""}">${mine ? "" : av(who)}<div class="bubble"><span class="mwho">${mine ? "You" : esc(first(who?.name || "Someone"))} · ${relTime(m.at)}</span>${esc(m.text)}</div>${mine || isHost(h) ? `<button class="mdel" data-delmsg="${m.id}" data-id="${h.id}" aria-label="Delete message">×</button>` : ""}</div>`; }).join("") : `<p class="muted small" style="margin:0">No messages yet. Say hi, or let people know you're running late.</p>`}</div>
      <div class="chips">${quick.map((q) => `<button class="chip" data-quick="${esc(q)}" data-id="${h.id}">${esc(q)}</button>`).join("")}</div>
      <form class="send" data-form="comment"><input class="input" id="c-text" maxlength="400" placeholder="Message the crew" autocomplete="off" aria-label="Message"><button class="btn sm cherry" type="submit">Send</button></form>
    </section>
  </div>`;
}
function hostPanel(h, tally, waiting) {
  const isHouse = h.spot.kind === "house";
  return `<section class="block host">
    <span class="label">Headcount</span>
    <div class="counts">
      <div><b>${h.going.length}${h.cap ? `<small>/${h.cap}</small>` : ""}</b><span>In</span></div>
      <div><b>${h.maybe.length}</b><span>Maybe</span></div>
      <div><b>${h.declined.length}</b><span>Can't</span></div>
      <div><b>${waiting.length}</b><span>No reply</span></div>
    </div>
    ${peopleList(h.going, "In", true)}
    ${peopleList(h.maybe, "Maybe")}
    ${peopleList(h.declined, "Can't make it")}
    ${waiting.length ? `<div class="nudge"><div><b>Still waiting on</b><div class="muted small">${esc(waiting.map((m) => first(m.name)).join(", "))}</div></div><button class="btn sm cherry" data-act="nudge" data-id="${h.id}">Nudge them</button></div>`
      : S.crew.members.length < 2 ? `<div class="nudge"><div><b>Nobody to invite yet</b><div class="muted small">Your crew is just you so far.</div></div><button class="btn sm cherry" data-act="invite-sheet">Invite friends</button></div>` : ""}
  </section>
  <section class="block">
    <span class="label">${isHouse ? "What to make" : "The group order"}</span>
    ${tally.length ? tally.map((t) => `<div class="trow"><b>${t.people.length}×</b><span>${esc(t.order)}</span><span class="muted small">${esc(t.people.join(", "))}</span></div>`).join("") : `<p class="muted small" style="margin:0">Orders show up here as people say they're in.</p>`}
    ${tally.length ? `<div class="btnrow"><button class="btn soft sm" data-act="copy-order" data-id="${h.id}">Copy order</button></div>` : ""}
  </section>
  <section class="block">
    <span class="label">Host tools</span>
    <div class="btnrow">
      <button class="btn soft sm" data-act="edit-hang" data-id="${h.id}">Edit time or place</button>
      <button class="btn soft sm" data-act="share-hang" data-id="${h.id}">Share outside the crew</button>
      <button class="btn ghost sm danger" data-act="cancel-hang" data-id="${h.id}">Cancel hang</button>
    </div>
  </section>`;
}
function bringBlock(h) {
  return `<section class="block">
    <span class="label">Who's bringing what</span>
    ${h.bring.length ? h.bring.map((it) => { const who = it.claimedBy ? member(it.claimedBy) : null; const mine = it.claimedBy === S.user.id; return `<div class="bring">
      <span class="bitem">${esc(it.item)}</span>
      ${who ? `<span class="small ${mine ? "" : "muted"}">${mine ? "You've got it" : `${esc(first(who.name))} has it`}</span>` : `<span class="small muted">Nobody yet</span>`}
      ${!who || mine ? `<button class="btn sm ${mine ? "soft" : ""}" data-claim="${it.id}" data-id="${h.id}">${mine ? "Undo" : "I'll bring it"}</button>` : ""}
      ${it.addedBy === S.user.id || isHost(h) ? `<button class="mdel" data-delbring="${it.id}" data-id="${h.id}" aria-label="Remove ${esc(it.item)}">×</button>` : ""}
    </div>`; }).join("") : `<p class="muted small" style="margin:0">${isHost(h) ? "Add anything you'd like help with, like pastries or oat milk." : "Nothing on the list yet. Offer something below."}</p>`}
    <form class="send" data-form="bring"><input class="input" id="b-item" maxlength="60" placeholder="${isHost(h) ? "Pastries, oat milk…" : "I'll bring…"}" autocomplete="off" aria-label="Item to bring"><button class="btn sm" type="submit">Add</button></form>
  </section>`;
}

function crewView() {
  const g = S.crew;
  const members = [...g.members].sort((a, b) => (a.id === S.user.id ? -1 : b.id === S.user.id ? 1 : a.name.localeCompare(b.name)));
  return `<div class="spacer"></div>
    <div style="display:flex;flex-direction:column;gap:6px;margin:6px 2px 18px">
      <span class="label">${g.members.length} ${g.members.length === 1 ? "person" : "people"}</span>
      <h1 class="h-lg">${esc(g.name)}</h1>
    </div>
    <button class="btn cherry block lg" data-act="invite-sheet">Invite friends</button>
    <div class="section-head"><h2 class="h-md">Usual orders</h2></div>
    <div class="list">${members.map((m) => `<div class="person">${av(m, "lg")}<div class="info">
      <div class="name">${esc(m.name)}${m.id === S.user.id ? ` <span class="tag">You</span>` : ""}${m.id === g.ownerId ? ` <span class="tag">Started it</span>` : ""}</div>
      <div class="order">${m.order ? esc(m.order) : "No usual yet"}</div></div></div>`).join("")}</div>
    <div class="section-head"><h2 class="h-md">Crew settings</h2></div>
    <div class="card">
      <button class="btn soft block" data-act="rename-sheet">Rename crew</button>
      <button class="btn soft block" data-act="new-crew-sheet">Start another crew</button>
      <button class="btn ghost block danger" data-act="leave-sheet">Leave ${esc(g.name)}</button>
    </div>`;
}

function youView() {
  const u = S.user;
  return `<div class="spacer"></div>
    <div class="profile-head">${av(u, "xl")}<div><h1 class="h-lg">${esc(u.name)}</h1><div class="muted">${u.order ? esc(u.order) : "No usual order yet"}</div></div></div>
    <form class="form card" data-form="profile">
      <div class="field"><label class="label" for="p-name">Name</label><input class="input" id="p-name" name="name" maxlength="40" required value="${esc(u.name)}" autocomplete="name"></div>
      <div class="field"><label class="label" for="p-order">Your usual order</label><input class="input" id="p-order" name="order" maxlength="60" value="${esc(u.order)}" placeholder="Oat cortado"></div>
      <div class="field"><span class="label">Your color</span><div class="swatches" role="group" aria-label="Color">${COLORS.map((c) => `<button type="button" class="swatch c-${c}" data-color="${c}" aria-label="${c}" aria-pressed="${u.color === c}"></button>`).join("")}</div></div>
      <div class="field"><label class="label" for="p-addr">Your address (for house hangs)</label><input class="input" id="p-addr" maxlength="120" value="${esc(u.home?.address || "")}" placeholder="Street address" autocomplete="street-address">
        <span class="muted small">Only your crews see this, and only on hangs at your place.</span></div>
      <div class="field"><label class="label" for="p-note">Getting in</label><input class="input" id="p-note" maxlength="160" value="${esc(u.home?.note || "")}" placeholder="Side door, dog is friendly, park on the street"></div>
      <p class="err" id="p-err" hidden></p>
      <button class="btn block" type="submit">Save</button>
    </form>
    <div class="section-head"><h2 class="h-md">Your account</h2></div>
    <div class="card">
      <span class="muted small">CupUp keeps you signed in on this phone. Use one of these to sign in somewhere else.</span>
      <button class="btn soft block" data-act="link-sheet">Sign in on another phone</button>
      ${config.email ? `<button class="btn soft block" data-act="email-sheet">${u.email ? `Email: ${esc(u.email)}` : "Add an email for sign-in"}</button>` : ""}
      <button class="btn ghost block danger" data-act="signout-sheet">Sign out</button>
    </div>
    <p class="foot">Add CupUp to your home screen from your browser's share menu.</p>`;
}

/* ------------------------------------------------------------------ sheets */
function openSheet(kind, data = {}) { UI.sheet = { kind, ...data }; renderSheet(); setTimeout(() => $("#sheet-root [autofocus]")?.focus(), 60); }
function closeSheet() { UI.sheet = null; renderSheet(); }
function renderSheet() {
  const root = $("#sheet-root");
  if (!UI.sheet) { root.innerHTML = ""; document.body.style.overflow = ""; return; }
  document.body.style.overflow = "hidden";
  const fn = SHEETS[UI.sheet.kind];
  root.innerHTML = `<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true">${'<div class="grab"></div>'}${fn(UI.sheet)}</div></div>`;
}
const head = (t) => `<div class="sheet-head"><h2 class="h-lg" style="font-size:28px">${t}</h2><button class="btn ghost sm" data-act="close" aria-label="Close">Close</button></div>`;

const SHEETS = {
  onboard(s) {
    const color = s.color || COLORS[Math.floor(Math.random() * 6)];
    s.color = color;
    return `${head(UI.pending ? "Join the crew" : "Make your profile")}
    <form class="form" data-form="register">
      <div style="display:flex;align-items:center;gap:14px"><span id="ob-av">${av({ name: s.name || "?", color }, "lg")}</span><span class="muted small">This is how your friends will see you.</span></div>
      <div class="field"><label class="label" for="ob-name">Your name</label><input class="input" id="ob-name" name="name" maxlength="40" required autocomplete="given-name" placeholder="First name works" autofocus></div>
      <div class="field"><label class="label" for="ob-order">Your usual order</label><input class="input" id="ob-order" name="order" maxlength="60" placeholder="Oat cortado">
        <div class="chips">${ORDERS.map((o) => `<button type="button" class="chip" data-fill="#ob-order" data-val="${esc(o)}">${esc(o)}</button>`).join("")}</div></div>
      <div class="field"><span class="label">Pick a color</span><div class="swatches" role="group" aria-label="Color">${COLORS.map((c) => `<button type="button" class="swatch c-${c}" data-obcolor="${c}" aria-label="${c}" aria-pressed="${color === c}"></button>`).join("")}</div></div>
      <p class="err" id="ob-err" hidden></p>
      <button class="btn cherry lg block" type="submit">${UI.pending ? "Join" : "Let's go"}</button>
    </form>`;
  },
  hang(s) {
    const edit = s.edit ? S.crew.hangs.find((h) => h.id === s.edit) : null;
    const f = s.f || (s.f = edit
      ? { title: edit.title, kind: edit.spot.kind, houseOf: edit.spot.houseOf || S.user.id, date: edit.date, time: edit.time, vibe: edit.vibe, note: edit.note, cap: edit.cap || 0 }
      : { title: "", kind: "", houseOf: S.user.id, date: ymd(addDays(new Date(), 1)), time: "09:00", vibe: VIBES[0], note: "", cap: 0 });
    if (edit && f.cap === undefined) f.cap = edit.cap || 0;
    const days = Array.from({ length: 10 }, (_, i) => addDays(new Date(), i));
    const times = ["07:00", "08:00", "09:00", "10:00", "11:00", "14:00", "16:00"];
    const others = [...S.crew.members].sort((a, b) => (a.id === S.user.id ? -1 : b.id === S.user.id ? 1 : a.name.localeCompare(b.name)));
    return `${head(edit ? "Edit hang" : "Start a hang")}
    <form class="form" data-form="hang">
      <div class="field"><span class="label">Where</span>
        <div class="spots" role="group" aria-label="Where">
          <button type="button" class="spot" data-kind="york" aria-pressed="${f.kind === "york"}">${ICONS.cup}Thump York<small>Thump Coffee</small></button>
          <button type="button" class="spot" data-kind="grove" aria-pressed="${f.kind === "grove"}">${ICONS.cupTall}Thump Grove<small>Thump Coffee</small></button>
          <button type="button" class="spot" data-kind="house" aria-pressed="${f.kind === "house"}">${ICONS.house}Someone's place<small>House hang</small></button>
        </div>
        ${f.kind === "house" ? `<span class="label" style="margin-top:6px">Whose place?</span><div class="chips">${others.map((m) => `<button type="button" class="chip" data-house="${m.id}" aria-pressed="${f.houseOf === m.id}">${m.id === S.user.id ? "Mine" : esc(first(m.name)) + "'s"}</button>`).join("")}</div>` : ""}
      </div>
      <div class="field"><span class="label">Day</span>
        <div class="chips scroll" role="group" aria-label="Day">${days.map((d, i) => { const v = ymd(d); return `<button type="button" class="chip day" data-date="${v}" aria-pressed="${f.date === v}"><small>${i === 0 ? "Today" : i === 1 ? "Tmrw" : d.toLocaleDateString("en-US", { weekday: "short" })}</small><b>${d.getDate()}</b></button>`; }).join("")}</div>
        <input class="input" type="date" id="h-date" value="${esc(f.date)}" min="${ymd(new Date())}" aria-label="Or pick a date">
      </div>
      <div class="field"><span class="label">Time</span>
        <div class="chips" role="group" aria-label="Time">${times.map((t) => `<button type="button" class="chip" data-time="${t}" aria-pressed="${f.time === t}">${fmtTime(t)}</button>`).join("")}</div>
        <input class="input" type="time" id="h-time" value="${esc(f.time)}" aria-label="Or pick a time">
      </div>
      ${f.kind && f.kind !== "house" ? (() => { const hn = hoursNote({ spot: { kind: f.kind }, date: f.date, time: f.time }); return hn ? `<div class="warn">${esc(hn)}</div>` : ""; })() : ""}
      ${f.kind === "house" && f.houseOf === S.user.id && !S.user.home?.address ? `<div class="field"><label class="label" for="h-addr">Your address (only your crew sees it)</label><input class="input" id="h-addr" maxlength="120" placeholder="Street address" autocomplete="street-address"></div>` : ""}
      <div class="field"><span class="label">Room for</span>
        <div class="chips" role="group" aria-label="Room for">${[0, 2, 3, 4, 6, 8].map((n) => `<button type="button" class="chip" data-cap="${n}" aria-pressed="${(f.cap || 0) === n}">${n ? n + " people" : "Anyone"}</button>`).join("")}</div>
      </div>
      <div class="field"><span class="label">Vibe</span>
        <div class="chips" role="group" aria-label="Vibe">${VIBES.map((v) => `<button type="button" class="chip" data-vibe="${esc(v)}" aria-pressed="${f.vibe === v}">${esc(v)}</button>`).join("")}</div>
      </div>
      <div class="field"><label class="label" for="h-title">Call it something (optional)</label>
        <input class="input" id="h-title" maxlength="60" value="${esc(f.title)}" placeholder="${esc(TITLES[new Date().getDay() % TITLES.length])}"></div>
      <div class="field"><label class="label" for="h-note">Note (optional)</label>
        <textarea class="input" id="h-note" maxlength="240" placeholder="I'll grab the big table by the window">${esc(f.note)}</textarea></div>
      <p class="err" id="h-err" hidden></p>
      <button class="btn cherry lg block" type="submit" ${UI.busy ? "disabled" : ""}>${edit ? "Save changes" : "Post hang"}</button>
    </form>`;
  },
  home() {
    return `${head("Your address")}
      <form class="form" data-form="home">
        <p class="lede">Shown to your crews only on hangs at your place, with a Directions button.</p>
        <div class="field"><label class="label" for="home-addr">Street address</label><input class="input" id="home-addr" maxlength="120" value="${esc(S.user.home?.address || "")}" autocomplete="street-address" autofocus></div>
        <div class="field"><label class="label" for="home-note">Getting in (optional)</label><input class="input" id="home-note" maxlength="160" value="${esc(S.user.home?.note || "")}" placeholder="Side door, dog is friendly"></div>
        <button class="btn cherry lg block" type="submit">Save</button>
      </form>`;
  },
  invite() {
    const link = `${location.origin}/join/${S.crew.code}`;
    return `${head("Invite friends")}
      <div class="form">
        <p class="lede">Send this link to the group chat. Anyone with it can join ${esc(S.crew.name)}.</p>
        <div class="linkbox" id="invite-link">${esc(link)}</div>
        <button class="btn cherry lg block" data-act="share-invite">${navigator.share && isMobile() ? "Send invite" : "Copy invite link"}</button>
        ${navigator.share && isMobile() ? `<button class="btn soft block" data-act="copy-invite">Copy link</button>` : ""}
      </div>`;
  },
  crews() {
    return `${head("Your crews")}
      <div class="list">${S.crews.map((c) => `<button class="person" style="border:0;text-align:left;width:100%" data-switch="${c.code}">
        <span class="av lg c-${colorOf(c.code)}">${esc(initials(c.name))}</span>
        <div class="info"><div class="name">${esc(c.name)}</div><div class="order">${c.memberCount} ${c.memberCount === 1 ? "person" : "people"}</div></div>
        ${c.code === S.current ? `<span class="tag">Here</span>` : ""}</button>`).join("")}</div>
      <div class="spacer"></div>
      <button class="btn soft block" data-act="new-crew-sheet">Start another crew</button>`;
  },
  newCrew() {
    return `${head("Start a crew")}
      <form class="form" data-form="crew">
        <div class="field"><label class="label" for="crew-name">Crew name</label><input class="input" id="crew-name" name="name" maxlength="40" required placeholder="Work coffee crew" autofocus autocomplete="off"></div>
        <p class="err" id="crew-err" hidden></p>
        <button class="btn cherry lg block" type="submit">Start crew</button>
      </form>`;
  },
  rename() {
    return `${head("Rename crew")}
      <form class="form" data-form="rename">
        <div class="field"><label class="label" for="rn">Crew name</label><input class="input" id="rn" name="name" maxlength="40" required value="${esc(S.crew.name)}" autofocus autocomplete="off"></div>
        <p class="err" id="rn-err" hidden></p>
        <button class="btn lg block" type="submit">Save</button>
      </form>`;
  },
  leave() {
    return `${head("Leave crew?")}
      <div class="form"><p class="lede">You'll drop off every hang in ${esc(S.crew.name)}. You can rejoin later with an invite link.</p>
      <div class="actions"><button class="btn soft" data-act="close">Stay</button><button class="btn cherry" data-act="leave">Leave</button></div></div>`;
  },
  cancelHang(s) {
    const h = S.crew.hangs.find((x) => x.id === s.id);
    return `${head("Cancel this hang?")}
      <div class="form"><p class="lede">${esc(h?.title || "This hang")} will disappear for everyone.</p>
      <div class="actions"><button class="btn soft" data-act="close">Keep it</button><button class="btn cherry" data-act="confirm-cancel" data-id="${esc(s.id)}">Cancel hang</button></div></div>`;
  },
  link(s) {
    return `${head("Sign in on another phone")}
      <div class="form">
        ${s.code ? `<p class="lede">On your other phone, open CupUp, tap Sign in, and enter this code. It works for 10 minutes.</p><div class="codebig">${esc(s.code)}</div>`
          : s.error ? `<p class="err">${esc(s.error)}</p>` : `<div class="boot" style="min-height:120px"><span class="bean big"></span></div>`}
      </div>`;
  },
  signin(s) {
    return `${head("Sign in")}
      <form class="form" data-form="redeem">
        <p class="lede">On a phone where you're already signed in, go to You, then Sign in on another phone. Enter the code here.</p>
        <input class="input code" id="code" name="code" maxlength="6" required placeholder="ABC123" autocomplete="one-time-code" autocapitalize="characters" autofocus>
        <p class="err" id="code-err" hidden></p>
        <button class="btn cherry lg block" type="submit">Sign in</button>
      </form>
      ${config.email ? `<div class="spacer"></div><form class="form card" data-form="email-login">
        <b>Or get a link by email</b>
        ${s.sent ? `<p class="muted small">If that email is on a CupUp account, a sign-in link is on its way.</p>` : `
        <input class="input" type="email" id="em" name="email" required placeholder="you@email.com" autocomplete="email">
        <button class="btn soft block" type="submit">Email me a link</button>`}
      </form>` : ""}`;
  },
  email(s) {
    return `${head("Email sign-in")}
      ${s.sent ? `<p class="lede">Check your inbox and tap the link to confirm. Then you can sign in from any device with your email.</p>`
      : `<form class="form" data-form="email-verify">
        <p class="lede">Add your email so you can always get back into CupUp.</p>
        <input class="input" type="email" id="em2" name="email" required value="${esc(S.user.email || "")}" placeholder="you@email.com" autocomplete="email" autofocus>
        <p class="err" id="em-err" hidden></p>
        <button class="btn cherry lg block" type="submit">Send confirm link</button>
      </form>`}`;
  },
  signout() {
    return `${head("Sign out?")}
      <div class="form"><p class="lede">To get back in, you'll need a code from another phone${config.email ? " or your email" : ""}. If this is your only phone, stay signed in.</p>
      <div class="actions"><button class="btn soft" data-act="close">Stay signed in</button><button class="btn cherry" data-act="signout">Sign out</button></div></div>`;
  },
};

/* ------------------------------------------------------------------ actions */
function showErr(id, msg) { const el = document.getElementById(id); if (el) { el.textContent = msg; el.hidden = false; } else toast(msg); }

async function shareText(text, url) {
  if (navigator.share && isMobile()) {
    try { await navigator.share({ text, url }); return; } catch (e) { if (e?.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(`${text} ${url}`.trim()); toast("Copied. Paste it in the group chat."); }
  catch { toast("Press and hold the link to copy it."); }
}

async function doJoin() {
  const code = UI.pending.code, h = UI.pending.h;
  UI.busy = true; render();
  try {
    const d = await api(`crew/${code}/join`, { method: "POST" });
    setCrew(d.crew); UI.pending = null; UI.tab = "hangs"; UI.hang = h && S.crew?.hangs.some((x) => x.id === h) ? h : null;
    await refreshMe().catch(() => {});
    toast(`You're in ${d.crew.name}.`);
  } catch (e) { toast(e.message); }
  UI.busy = false; render();
}

async function rsvp(id, status) {
  const h = hangById(id);
  if (!h || myStatus(h) === status) return;
  const me = S.user.id;
  const prev = JSON.stringify([h.going, h.maybe, h.declined]);
  h.going = h.going.filter((x) => x !== me); h.maybe = h.maybe.filter((x) => x !== me); h.declined = h.declined.filter((x) => x !== me);
  ({ going: h.going, maybe: h.maybe, cant: h.declined })[status]?.push(me);
  render();
  try {
    const d = await api(`crew/${S.crew.code}/hang/${id}/rsvp`, { method: "POST", body: { status } });
    setCrew(d.crew); render();
    toast(status === "going" ? "You're in. See you there." : status === "maybe" ? "Marked maybe. The host can see it." : "Got it. The host knows you can't make it.");
  } catch (e) { [h.going, h.maybe, h.declined] = JSON.parse(prev); toast(e.message); render(); }
}

async function hangAction(id, path, opts, okMsg) {
  try {
    const d = await api(`crew/${S.crew.code}/hang/${id}/${path}`, opts);
    setCrew(d.crew); render(); if (okMsg) toast(okMsg);
    return true;
  } catch (e) { toast(e.message); return false; }
}
function openHang(id) { UI.hang = id; UI.tab = "hangs"; closeSheet(); render(); window.scrollTo({ top: 0 }); }
function markSeen() {
  if (!S.crew) return;
  S.seen = { ...(S.seen || {}), [S.crew.code]: new Date().toISOString() }; save();
}

document.addEventListener("click", async (e) => {
  const t = e.target.closest("button, [data-open], [data-act='scrim']");
  if (!t) return;
  if (t.dataset.open && !t.dataset.act) { openHang(t.dataset.open); return; }
  if (t.dataset.act === "scrim") { if (e.target === t) closeSheet(); return; }
  const a = t.dataset.act;

  if (t.dataset.tab) { if (UI.tab === t.dataset.tab) UI.hang = null; UI.tab = t.dataset.tab; render(); window.scrollTo({ top: 0 }); return; }
  if (t.dataset.rsvp) return rsvp(t.dataset.id, t.dataset.rsvp);
  if (t.dataset.quick) return hangAction(t.dataset.id, "comment", { method: "POST", body: { text: t.dataset.quick } });
  if (t.dataset.delmsg) return hangAction(t.dataset.id, `comment/${t.dataset.delmsg}`, { method: "DELETE" });
  if (t.dataset.claim) return hangAction(t.dataset.id, `bring/${t.dataset.claim}/claim`, { method: "POST" });
  if (t.dataset.delbring) return hangAction(t.dataset.id, `bring/${t.dataset.delbring}`, { method: "DELETE" });
  if (t.dataset.cap !== undefined && UI.sheet?.kind === "hang") {
    const f = UI.sheet.f; f.title = $("#h-title").value; f.note = $("#h-note").value; f.cap = Number(t.dataset.cap);
    const top = $(".sheet").scrollTop; renderSheet(); $(".sheet").scrollTop = top; return;
  }
  if (t.dataset.switch) { S.current = t.dataset.switch; S.crew = null; save(); closeSheet(); render(); await refreshCrew().catch((x) => toast(x.message)); render(); return; }

  // onboarding sheet
  if (t.dataset.obcolor) {
    UI.sheet.color = t.dataset.obcolor;
    document.querySelectorAll("[data-obcolor]").forEach((b) => b.setAttribute("aria-pressed", b === t));
    $("#ob-av").innerHTML = av({ name: $("#ob-name").value || "?", color: UI.sheet.color }, "lg");
    return;
  }
  if (t.dataset.fill) { const i = $(t.dataset.fill); i.value = t.dataset.val; i.focus(); return; }
  if (t.dataset.color) { document.querySelectorAll("[data-color]").forEach((b) => b.setAttribute("aria-pressed", b === t)); return; }

  // hang sheet pickers
  if (UI.sheet?.kind === "hang" && (t.dataset.kind || t.dataset.house || t.dataset.date || t.dataset.time || t.dataset.vibe)) {
    const f = UI.sheet.f;
    f.title = $("#h-title").value; f.note = $("#h-note").value;
    if (t.dataset.kind) f.kind = t.dataset.kind;
    if (t.dataset.house) f.houseOf = t.dataset.house;
    if (t.dataset.date) f.date = t.dataset.date;
    if (t.dataset.time) f.time = t.dataset.time;
    if (t.dataset.vibe) f.vibe = t.dataset.vibe;
    const top = $(".sheet").scrollTop; renderSheet(); $(".sheet").scrollTop = top;
    return;
  }

  switch (a) {
    case "close": return closeSheet();
    case "back": UI.hang = null; render(); return;
    case "seen": markSeen(); render(); return;
    case "home-sheet": return openSheet("home");
    case "nudge": {
      const h = hangById(t.dataset.id);
      const names = noReply(h).map((m) => first(m.name));
      const lead = names.length > 2 ? `${names.slice(0, -1).join(", ")} and ${names.slice(-1)}` : names.join(" and ");
      return shareText(`${lead}, are you in for ${h.title}? ${dayWord(h.date)} at ${fmtTime(h.time)}, ${spotLine(h)}. Tap to answer:`, `${location.origin}/join/${S.crew.code}?h=${h.id}`);
    }
    case "copy-order": {
      const h = hangById(t.dataset.id);
      const text = orderTally(h.going).map((x) => `${x.people.length}x ${x.order}`).join("\n");
      try { await navigator.clipboard.writeText(text); toast("Order copied."); } catch { toast("Couldn't copy. Press and hold to select it."); }
      return;
    }
    case "onboard": return openSheet("onboard");
    case "signin-sheet": return openSheet("signin");
    case "new-hang": return openSheet("hang");
    case "edit-hang": return openSheet("hang", { edit: t.dataset.id });
    case "cancel-hang": return openSheet("cancelHang", { id: t.dataset.id });
    case "invite-sheet": return openSheet("invite");
    case "crews-sheet": return openSheet("crews");
    case "new-crew-sheet": return openSheet("newCrew");
    case "rename-sheet": return openSheet("rename");
    case "leave-sheet": return openSheet("leave");
    case "signout-sheet": return openSheet("signout");
    case "email-sheet": return openSheet("email");
    case "skip-join": UI.pending = null; return render();
    case "join": return doJoin();
    case "share-invite": return shareText(`Come get coffee with ${S.crew.name} on CupUp:`, `${location.origin}/join/${S.crew.code}`);
    case "copy-invite":
      try { await navigator.clipboard.writeText(`${location.origin}/join/${S.crew.code}`); toast("Link copied."); } catch { toast("Press and hold the link to copy it."); }
      return;
    case "share-hang": {
      const h = S.crew.hangs.find((x) => x.id === t.dataset.id);
      if (h) shareText(`☕ ${h.title}: ${dayWord(h.date)} at ${fmtTime(h.time)}, ${spotLine(h)}. ${h.going.length} in so far. You in?`, `${location.origin}/join/${S.crew.code}?h=${h.id}`);
      return;
    }
    case "confirm-cancel":
      try { const d = await api(`crew/${S.crew.code}/hang/${t.dataset.id}`, { method: "DELETE" }); setCrew(d.crew); UI.hang = null; closeSheet(); render(); toast("Hang cancelled. The crew will see it's off."); }
      catch (x) { toast(x.message); }
      return;
    case "leave":
      try {
        await api(`crew/${S.crew.code}/leave`, { method: "POST" });
        const left = S.crew.name;
        S.crews = S.crews.filter((c) => c.code !== S.current); S.current = S.crews[0]?.code || null; S.crew = null; save();
        closeSheet(); UI.tab = "hangs"; render(); toast(`You left ${left}.`);
        if (S.current) { await refreshCrew().catch(() => {}); render(); }
      } catch (x) { toast(x.message); }
      return;
    case "link-sheet":
      openSheet("link");
      try { const d = await api("auth/link", { method: "POST" }); if (UI.sheet?.kind === "link") { UI.sheet.code = d.code; renderSheet(); } }
      catch (x) { if (UI.sheet?.kind === "link") { UI.sheet.error = x.message; renderSheet(); } }
      return;
    case "signout":
      api("me", { method: "PATCH", body: { signOut: true } }).catch(() => {});
      signOutLocal(); UI.sheet = null; UI.tab = "hangs"; render(); toast("Signed out.");
      return;
  }
});

document.addEventListener("input", (e) => {
  if (e.target.id === "ob-name" && UI.sheet) $("#ob-av").innerHTML = av({ name: e.target.value || "?", color: UI.sheet.color }, "lg");
  if (UI.sheet?.kind === "hang") {
    const f = UI.sheet.f;
    if (e.target.id === "h-date" && e.target.value) { f.date = e.target.value; document.querySelectorAll("[data-date]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.date === f.date)); }
    if (e.target.id === "h-time" && e.target.value) { f.time = e.target.value; document.querySelectorAll("[data-time]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.time === f.time)); }
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && UI.sheet) closeSheet();
  if (e.key === "Enter" && e.target.matches?.("article[data-open]")) openHang(e.target.dataset.open);
});

document.addEventListener("submit", async (e) => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;
  const btn = form.querySelector("[type=submit]");
  if (btn) btn.disabled = true;
  try {
    if (kind === "register") {
      const name = $("#ob-name").value.trim();
      if (!name) throw Object.assign(new Error("Tell us your name"), { field: "ob-err" });
      const d = await api("auth/register", { method: "POST", body: { name, order: $("#ob-order").value, color: UI.sheet.color } });
      S.token = d.token; S.user = d.user; save();
      closeSheet();
      if (UI.pending) return doJoin();
      render();
    }
    if (kind === "crew") {
      const d = await api("crew", { method: "POST", body: { name: form.querySelector("[name=name]").value } });
      setCrew(d.crew); UI.tab = "hangs"; closeSheet(); render();
      openSheet("invite"); toast("Crew started. Now invite your people.");
    }
    if (kind === "paste") {
      const v = form.querySelector("[name=link]").value.trim();
      const m = v.match(/join\/([A-Za-z0-9]{6})/) || v.match(/^([A-Za-z0-9]{6})$/);
      if (!m) throw new Error("That doesn't look like a CupUp invite link.");
      await startJoin(m[1].toUpperCase());
    }
    if (kind === "rename") {
      const d = await api(`crew/${S.crew.code}`, { method: "PATCH", body: { name: form.querySelector("[name=name]").value } });
      setCrew(d.crew); closeSheet(); render(); toast("Crew renamed.");
    }
    if (kind === "profile") {
      const color = document.querySelector("[data-color][aria-pressed=true]")?.dataset.color || S.user.color;
      const d = await api("me", { method: "PATCH", body: { name: $("#p-name").value, order: $("#p-order").value, color, home: { address: $("#p-addr").value, note: $("#p-note").value } } });
      S.user = d.user; save();
      await refreshCrew().catch(() => {});
      render(); toast("Saved.");
    }
    if (kind === "hang") {
      const f = UI.sheet.f;
      f.title = $("#h-title").value.trim(); f.note = $("#h-note").value.trim();
      if (!f.kind) throw Object.assign(new Error("Pick where you're meeting"), { field: "h-err" });
      const body = { title: f.title || $("#h-title").placeholder, spot: { kind: f.kind, houseOf: f.kind === "house" ? f.houseOf : null }, date: f.date, time: f.time, vibe: f.vibe, note: f.note, cap: f.cap || 0 };
      const newAddr = $("#h-addr")?.value.trim();
      if (newAddr) { const u = await api("me", { method: "PATCH", body: { home: { address: newAddr, note: S.user.home?.note || "" } } }); S.user = u.user; save(); }
      if (atOf({ date: f.date, time: f.time }).getTime() < Date.now() - 15 * 60000) throw Object.assign(new Error("That time already passed. Pick a later one."), { field: "h-err" });
      const editing = UI.sheet.edit;
      const d = editing
        ? await api(`crew/${S.crew.code}/hang/${editing}`, { method: "PATCH", body })
        : await api(`crew/${S.crew.code}/hang`, { method: "POST", body });
      setCrew(d.crew); closeSheet(); UI.tab = "hangs"; UI.hang = editing || d.hang?.id; render(); window.scrollTo({ top: 0 });
      toast(editing ? "Updated. The crew will see what changed." : "Hang posted. Nudge people from here.");
    }
    if (kind === "comment") {
      const v = $("#c-text").value.trim();
      if (!v) return;
      if (await hangAction(UI.hang, "comment", { method: "POST", body: { text: v } })) { $("#c-text")?.blur(); document.querySelector(".chat")?.lastElementChild?.scrollIntoView({ block: "nearest" }); }
    }
    if (kind === "bring") {
      const v = $("#b-item").value.trim();
      if (!v) return;
      const h = hangById(UI.hang);
      await hangAction(UI.hang, "bring", { method: "POST", body: { item: v, mine: !isHost(h) } });
    }
    if (kind === "home") {
      const d = await api("me", { method: "PATCH", body: { home: { address: $("#home-addr").value, note: $("#home-note").value } } });
      S.user = d.user; save(); await refreshCrew().catch(() => {}); closeSheet(); render(); toast("Address saved. Only your crews can see it.");
    }
    if (kind === "redeem") {
      const d = await api("auth/redeem", { method: "POST", body: { code: $("#code").value } });
      S.token = d.token; S.user = d.user; save();
      await refreshMe(); closeSheet();
      if (UI.pending) return doJoin();
      await refreshCrew().catch(() => {}); render(); toast(`Welcome back, ${first(S.user.name)}.`);
    }
    if (kind === "email-login") {
      await api("auth/email/start", { method: "POST", body: { email: $("#em").value } });
      UI.sheet.sent = true; renderSheet();
    }
    if (kind === "email-verify") {
      await api("auth/email/start", { method: "POST", body: { email: $("#em2").value, mode: "verify" } });
      UI.sheet.sent = true; renderSheet();
    }
  } catch (x) {
    const map = { register: "ob-err", crew: "crew-err", rename: "rn-err", profile: "p-err", hang: "h-err", redeem: "code-err", "email-verify": "em-err" };
    showErr(x.field || map[kind] || "", x.message);
  } finally {
    if (btn && document.contains(btn)) btn.disabled = false;
  }
});

/* ------------------------------------------------------------------ routing + boot */
async function startJoin(code, h) {
  UI.pending = { code, h, preview: null };
  render();
  try {
    const d = await api(`crew/${code}`);
    if (d.crew) { setCrew(d.crew); UI.pending = null; UI.tab = "hangs"; UI.hang = h && S.crew?.hangs.some((x) => x.id === h) ? h : null; }
    else UI.pending.preview = d;
  } catch (e) {
    UI.pending = null;
    toast(e.status === 404 ? "That invite link doesn't work anymore. Ask for a fresh one." : e.message);
  }
  render();
}

async function boot() {
  try { config = await (await fetch("/api/config", { cache: "no-store" })).json(); } catch {}
  const url = new URL(location.href);
  const join = url.pathname.match(/^\/join\/([A-Za-z0-9]{6})/);
  const signin = url.pathname === "/signin" && url.searchParams.get("t");
  history.replaceState(null, "", "/");

  if (signin) {
    try {
      const d = await api("auth/email/finish", { method: "POST", body: { t: signin } });
      S.token = d.token; S.user = d.user; save();
      toast(d.verified ? "Email confirmed." : `Welcome back, ${first(d.user.name)}.`);
    } catch (e) { toast(e.message); }
  }
  if (S.token) {
    try { await refreshMe(); } catch (e) { if (!S.user) toast(e.message); }
  }
  if (join) return startJoin(join[1].toUpperCase(), url.searchParams.get("h"));
  render();
  if (S.token && S.current) { try { await refreshCrew(); } catch {} render(); }
}

/* keep the crew fresh while the app is open */
setInterval(async () => {
  if (document.hidden || !S.token || !S.current || UI.sheet || UI.busy) return;
  if (document.activeElement?.matches?.("input, textarea") && document.activeElement.value) return;
  const before = S.crew?.rev;
  try { await refreshCrew(); if (S.crew?.rev !== before) render(); } catch {}
}, 20000);
document.addEventListener("visibilitychange", async () => {
  if (document.hidden && UI.tab === "hangs" && !UI.hang) markSeen();
  if (!document.hidden && S.token && S.current && !UI.sheet) { try { await refreshCrew(); render(); } catch {} }
});

boot();
})();
