import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

/* ==========================================================================
 * CupUp API — accounts, crews (with invite codes) and coffee hangs.
 * Storage: Netlify Blobs. Same building blocks as CrewUp.
 * ========================================================================== */

const crews = () => getStore({ name: "cupup-crews", consistency: "strong" });
const users = () => getStore({ name: "cupup-users", consistency: "strong" });
const meta = () => getStore({ name: "cupup-meta", consistency: "strong" });

const H = { "Cache-Control": "no-store" };
const json = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...H, "Content-Type": "application/json" } });
const bad = (error: string, status = 400) => json({ error }, status);
const now = () => new Date().toISOString();
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const shortCode = (n = 6) => Array.from(crypto.randomBytes(n), (x) => CODE_CHARS[x % CODE_CHARS.length]).join("");
const rid = (n = 10) => crypto.randomBytes(n).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, n) || shortCode(n).toLowerCase();

const COLORS = ["cherry", "matcha", "blueberry", "butter", "plum", "tangerine", "sky", "espresso"];
const VIBES = ["Catch-up", "Walk & talk", "Laptop session", "Pastry run", "Morning slow", "Big news"];
const SPOTS = ["york", "grove", "house"];

async function body(req: Request) {
  try { return await req.json(); } catch { return {}; }
}

/* ---------------------------------------------------------------- accounts */
const validId = (id: unknown) => typeof id === "string" && /^[a-zA-Z0-9]{8,40}$/.test(id);
async function getAccount(id: string) {
  if (!validId(id)) return null;
  return (await users().get(id, { type: "json" })) as any;
}
const saveAccount = (acc: any) => users().setJSON(acc.id, acc);
function issueToken(acc: any) {
  const secret = crypto.randomBytes(24).toString("base64url").replace(/[^a-zA-Z0-9]/g, "");
  acc.tokens = [...(acc.tokens || []).slice(-9), sha(secret)];
  return `${acc.id}.${secret}`;
}
async function authed(req: Request) {
  const m = (req.headers.get("authorization") || "").match(/^Bearer\s+([a-zA-Z0-9]+)\.([a-zA-Z0-9]+)$/);
  if (!m) return null;
  const acc = await getAccount(m[1]);
  if (!acc || !(acc.tokens || []).includes(sha(m[2]))) return null;
  return acc;
}
const cleanColor = (c: unknown) => (COLORS.includes(c as string) ? (c as string) : COLORS[Math.floor(Math.random() * 6)]);
const publicAccount = (acc: any) => ({ id: acc.id, name: acc.name, order: acc.order || "", color: acc.color, home: acc.home || null, email: acc.email || null, crews: acc.crews || [] });
const memberOf = (acc: any) => ({ id: acc.id, name: acc.name, order: acc.order || "", color: acc.color, home: acc.home || null });

async function putTemp(key: string, data: any, minutes: number) {
  await meta().setJSON(`tmp:${key}`, { ...data, exp: Date.now() + minutes * 60000 });
}
async function takeTemp(key: string) {
  const v = (await meta().get(`tmp:${key}`, { type: "json" })) as any;
  if (!v) return null;
  await meta().delete(`tmp:${key}`);
  return v.exp >= Date.now() ? v : null;
}

/* ---------------------------------------------------------------- crews */
class Conflict extends Error { conflict = true; }
const validCode = (c: string) => /^[A-Z0-9]{6}$/.test(c);
async function loadCrew(code: string) {
  if (!validCode(code)) return null;
  const r: any = await crews().getWithMetadata(code, { type: "json" });
  if (!r?.data) return null;
  const g = normalize(r.data);
  Object.defineProperty(g, "__etag", { value: r.etag || null, enumerable: false, writable: true });
  return g;
}
async function saveCrew(g: any) {
  g.rev = (g.rev || 0) + 1;
  g.updatedAt = now();
  // keep the last 30 days of past hangs, nothing older
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  g.hangs = (g.hangs || []).filter((h: any) => h.date >= cutoff).slice(-300);
  const etag = g.__etag;
  const res: any = await crews().setJSON(g.code, g, etag ? { onlyIfMatch: etag } : {});
  if (etag && res && res.modified === false) throw new Conflict("changed");
  g.__etag = res?.etag || null;
  return g;
}
function normalize(g: any) {
  g.members ||= []; g.hangs ||= []; g.feed ||= [];
  for (const h of g.hangs) { h.going ||= []; h.maybe ||= []; h.declined ||= []; h.comments ||= []; h.bring ||= []; h.cap ||= 0; }
  return g;
}
function addFeed(g: any, ev: any) {
  g.feed = [...(g.feed || []), { id: rid(8), at: now(), ...ev }].slice(-80);
}
const isMember = (g: any, id: string) => g.members.some((m: any) => m.id === id);
function preview(g: any) {
  const today = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  return {
    preview: true, code: g.code, name: g.name,
    members: g.members.slice(0, 8).map((m: any) => ({ name: m.name.split(" ")[0], color: m.color })),
    memberCount: g.members.length,
    upcoming: g.hangs.filter((h: any) => h.date >= today).length,
    invitedBy: g.members.find((m: any) => m.id === g.ownerId)?.name?.split(" ")[0] || null,
  };
}

/* ---------------------------------------------------------------- hangs */
const isDate = (d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + "T12:00:00Z"));
const isTime = (t: unknown) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
function readHang(b: any, g: any, hostId: string) {
  const kind = SPOTS.includes(b?.spot?.kind) ? b.spot.kind : null;
  if (!kind) return { error: "Pick Thump York, Thump Grove, or someone's place" };
  let houseOf = null;
  if (kind === "house") {
    houseOf = str(b.spot.houseOf, 40);
    if (!isMember(g, houseOf)) return { error: "Pick whose place it's at" };
  }
  if (!isDate(b.date)) return { error: "Pick a day" };
  if (!isTime(b.time)) return { error: "Pick a time" };
  return {
    hang: {
      title: str(b.title, 60) || "Coffee hang",
      spot: { kind, houseOf },
      date: b.date, time: b.time,
      vibe: VIBES.includes(b.vibe) ? b.vibe : VIBES[0],
      note: str(b.note, 240),
      cap: Number.isInteger(b.cap) && b.cap >= 2 && b.cap <= 30 ? b.cap : 0,
      hostId,
    },
  };
}

/* ---------------------------------------------------------------- email (optional, via Resend) */
const emailOn = () => !!process.env.RESEND_API_KEY;
async function sendEmail(to: string, subject: string, html: string) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.CUPUP_EMAIL_FROM || "CupUp <onboarding@resend.dev>", to: [to], subject, html }),
  });
  if (!r.ok) console.error("email failed", r.status, await r.text().catch(() => ""));
  return r.ok;
}
const loginEmail = (link: string, verify: boolean) => `
<div style="font-family:system-ui,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#2A1D17">
  <h1 style="font-size:26px;margin:0 0 12px">${verify ? "Confirm your email" : "Your CupUp sign-in link"}</h1>
  <p style="font-size:16px;line-height:1.5">${verify ? "Tap below so you can sign back in to CupUp from any device." : "Tap below to sign in. The link works for 20 minutes."}</p>
  <p><a href="${link}" style="display:inline-block;background:#D9304B;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700">${verify ? "Confirm email" : "Sign in to CupUp"}</a></p>
  <p style="font-size:13px;color:#7a6f68">If you didn't ask for this, you can ignore it.</p>
</div>`;

/* ---------------------------------------------------------------- handler */
export default async (req: Request) => {
  const raw = ["GET", "HEAD", "OPTIONS"].includes(req.method) ? null : await req.arrayBuffer();
  for (let attempt = 0; ; attempt++) {
    const r = new Request(req.url, { method: req.method, headers: req.headers, body: raw });
    try {
      return await handle(r);
    } catch (e: any) {
      if (!e?.conflict || attempt >= 5) {
        console.error(e);
        return json({ error: e?.conflict ? "Lots happening at once. Try again." : "Something went wrong on our end. Try again." }, e?.conflict ? 409 : 500);
      }
      await new Promise((ok) => setTimeout(ok, 30 * (attempt + 1) + Math.random() * 40));
    }
  }
};

async function handle(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const path = url.pathname.replace(/^\/api\/?/, "");
  const p = path.split("/");
  const M = req.method;

  if (M === "GET" && path === "config") return json({ email: emailOn(), colors: COLORS, vibes: VIBES });

  /* ---------- accounts ---------- */
  if (M === "POST" && path === "auth/register") {
    const b = await body(req);
    const name = str(b.name, 40);
    if (!name) return bad("Tell us your name");
    const acc = { id: rid(16), name, order: str(b.order, 60), color: cleanColor(b.color), tokens: [], crews: [], createdAt: now() };
    const token = issueToken(acc);
    await saveAccount(acc);
    return json({ token, user: publicAccount(acc) });
  }

  if (M === "POST" && path === "auth/link") {
    const acc = await authed(req);
    if (!acc) return bad("Sign in first", 401);
    const code = shortCode(6);
    await putTemp(`link:${code}`, { userId: acc.id }, 10);
    return json({ code, minutes: 10 });
  }

  if (M === "POST" && path === "auth/redeem") {
    const b = await body(req);
    const code = str(b.code, 12).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const t = code.length === 6 ? await takeTemp(`link:${code}`) : null;
    if (!t) return bad("That code didn't work. Codes last 10 minutes, so make a fresh one on your other phone.", 404);
    const acc = await getAccount(t.userId);
    if (!acc) return bad("We couldn't find that account", 404);
    const token = issueToken(acc);
    await saveAccount(acc);
    return json({ token, user: publicAccount(acc) });
  }

  if (M === "POST" && path === "auth/email/start") {
    if (!emailOn()) return bad("Email sign-in isn't turned on yet", 501);
    const b = await body(req);
    const email = str(b.email, 120).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return bad("That doesn't look like an email address");
    const t = rid(24);
    if (b.mode === "verify") {
      const acc = await authed(req);
      if (!acc) return bad("Sign in first", 401);
      await putTemp(`mail:${t}`, { userId: acc.id, email }, 20);
      await sendEmail(email, "Confirm your email for CupUp", loginEmail(`${origin}/signin?t=${t}`, true));
    } else {
      const owner = (await meta().get(`email:${email}`, { type: "json" })) as any;
      if (owner?.userId) {
        await putTemp(`mail:${t}`, { userId: owner.userId }, 20);
        await sendEmail(email, "Your CupUp sign-in link", loginEmail(`${origin}/signin?t=${t}`, false));
      }
    }
    return json({ ok: true });
  }

  if (M === "POST" && path === "auth/email/finish") {
    const b = await body(req);
    const t = await takeTemp(`mail:${str(b.t, 40)}`);
    if (!t) return bad("That link has expired. Ask for a new one.", 404);
    const acc = await getAccount(t.userId);
    if (!acc) return bad("We couldn't find that account", 404);
    if (t.email) {
      if (acc.email && acc.email !== t.email) await meta().delete(`email:${acc.email}`);
      acc.email = t.email;
      await meta().setJSON(`email:${t.email}`, { userId: acc.id });
    }
    const token = issueToken(acc);
    await saveAccount(acc);
    return json({ token, user: publicAccount(acc), verified: !!t.email });
  }

  /* calendar file for a hang (the link is only shown to crew members) */
  if (M === "GET" && p[0] === "crew" && p[2] === "hang" && /\.ics$/i.test(url.pathname)) {
    const g = await loadCrew(p[1]);
    const id = (p[3] || "").replace(/\.ics$/i, "");
    const h = g?.hangs.find((x: any) => x.id === id);
    if (!h) return new Response("This hang was cancelled.", { status: 404 });
    const where = h.spot.kind === "york" ? "Thump Coffee York, 549 NW York Dr Suite 200, Bend, OR 97703"
      : h.spot.kind === "grove" ? "Thump Coffee Grove, 921 NW Mount Washington Dr, Bend, OR 97703"
      : (() => { const m = g.members.find((x: any) => x.id === h.spot.houseOf); return m ? `${m.name.split(" ")[0]}'s place${m.home?.address ? ", " + m.home.address : ""}` : "House hang"; })();
    const t = (d: string, tm: string) => d.replace(/-/g, "") + "T" + tm.replace(":", "") + "00";
    const [hh, mm] = h.time.split(":").map(Number);
    const endMin = hh * 60 + mm + 90;
    let endDate = h.date, endTime = `${String(Math.floor(endMin / 60) % 24).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
    if (endMin >= 1440) { const d = new Date(h.date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); endDate = d.toISOString().slice(0, 10); }
    const escI = (x: string) => String(x).replace(/\\/g, "\\\\").replace(/[,;]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CupUp//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      "BEGIN:VEVENT", `UID:${h.id}@cupup`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
      `DTSTART;TZID=America/Los_Angeles:${t(h.date, h.time)}`, `DTEND;TZID=America/Los_Angeles:${t(endDate, endTime)}`,
      `SUMMARY:${escI("☕ " + h.title)}`, `LOCATION:${escI(where)}`,
      `DESCRIPTION:${escI(`${h.vibe} with ${g.name}.${h.note ? " " + h.note : ""}\n${url.origin}/join/${g.code}?h=${h.id}`)}`,
      "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", "DESCRIPTION:Coffee in 30 minutes", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    return new Response(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `inline; filename="cupup-${h.id}.ics"`, "Cache-Control": "no-store" } });
  }

  /* everything below needs a signed-in account, except invite previews */
  const acc = await authed(req);

  if (M === "GET" && p[0] === "crew" && p[1] && !p[2] && !acc) {
    const g = await loadCrew(p[1]);
    if (!g) return bad("That invite link doesn't work anymore", 404);
    return json(preview(g));
  }

  if (!acc) return bad("Sign in first", 401);

  if (path === "me" && M === "GET") {
    const list = [];
    for (const code of acc.crews || []) {
      const g = await loadCrew(code);
      if (g && isMember(g, acc.id)) list.push({ code: g.code, name: g.name, memberCount: g.members.length });
    }
    return json({ user: publicAccount(acc), crews: list });
  }

  if (path === "me" && M === "PATCH") {
    const b = await body(req);
    if (b.signOut) {
      acc.tokens = (acc.tokens || []).slice(0, -1);
      await saveAccount(acc);
      return json({ ok: true });
    }
    if (b.name !== undefined) { const n = str(b.name, 40); if (!n) return bad("Your name can't be empty"); acc.name = n; }
    if (b.order !== undefined) acc.order = str(b.order, 60);
    if (b.color !== undefined) acc.color = cleanColor(b.color);
    if (b.home !== undefined) {
      const address = str(b.home?.address, 120), note = str(b.home?.note, 160);
      acc.home = address ? { address, note } : null;
    }
    await saveAccount(acc);
    for (const code of acc.crews || []) {
      for (let i = 0; i < 4; i++) {
        const g = await loadCrew(code);
        if (!g) break;
        const m = g.members.find((x: any) => x.id === acc.id);
        if (!m) break;
        Object.assign(m, memberOf(acc));
        try { await saveCrew(g); break; } catch (e: any) { if (!e.conflict) throw e; }
      }
    }
    return json({ user: publicAccount(acc) });
  }

  /* ---------- crews ---------- */
  if (M === "POST" && path === "crew") {
    const b = await body(req);
    const name = str(b.name, 40);
    if (!name) return bad("Give your crew a name");
    if ((acc.crews || []).length >= 20) return bad("That's a lot of crews. Leave one before starting another.");
    let code = shortCode(6);
    while (await crews().get(code)) code = shortCode(6);
    const g = { code, name, ownerId: acc.id, members: [{ ...memberOf(acc), joinedAt: now() }], hangs: [], createdAt: now(), rev: 0 };
    await saveCrew(g);
    acc.crews = [...(acc.crews || []), code];
    await saveAccount(acc);
    return json({ crew: g });
  }

  if (p[0] === "crew" && p[1]) {
    const g = await loadCrew(p[1]);
    if (!g) return bad("We couldn't find that crew", 404);
    const member = isMember(g, acc.id);

    if (M === "GET" && !p[2]) return json(member ? { crew: g } : preview(g));

    if (M === "POST" && p[2] === "join") {
      if (!member) {
        if (g.members.length >= 60) return bad("This crew is full");
        g.members.push({ ...memberOf(acc), joinedAt: now() });
        addFeed(g, { type: "join", actor: acc.id });
        await saveCrew(g);
      }
      if (!(acc.crews || []).includes(g.code)) { acc.crews = [...(acc.crews || []), g.code]; await saveAccount(acc); }
      return json({ crew: g });
    }

    if (!member) return bad("Join this crew first", 403);

    if (M === "POST" && p[2] === "leave") {
      g.members = g.members.filter((m: any) => m.id !== acc.id);
      for (const h of g.hangs) { h.going = h.going.filter((x: string) => x !== acc.id); h.maybe = h.maybe.filter((x: string) => x !== acc.id); h.declined = h.declined.filter((x: string) => x !== acc.id); }
      if (g.ownerId === acc.id && g.members[0]) g.ownerId = g.members[0].id;
      await saveCrew(g);
      acc.crews = (acc.crews || []).filter((c: string) => c !== g.code);
      await saveAccount(acc);
      return json({ ok: true });
    }

    if (M === "PATCH" && !p[2]) {
      const b = await body(req);
      const name = str(b.name, 40);
      if (!name) return bad("Give your crew a name");
      g.name = name;
      await saveCrew(g);
      return json({ crew: g });
    }

    if (M === "POST" && p[2] === "hang" && !p[3]) {
      const b = await body(req);
      const { hang, error } = readHang(b, g, acc.id);
      if (error) return bad(error);
      const h = { id: rid(10), ...hang, going: [acc.id], maybe: [], declined: [], comments: [], bring: [], changed: null, createdAt: now() };
      g.hangs.push(h);
      addFeed(g, { type: "hang", actor: acc.id, hangId: h.id });
      await saveCrew(g);
      return json({ crew: g, hang: h });
    }

    if (p[2] === "hang" && p[3]) {
      const h = g.hangs.find((x: any) => x.id === p[3]);
      if (!h) return bad("That hang was cancelled", 404);

      if (M === "POST" && p[4] === "rsvp") {
        const b = await body(req);
        const wasGoing = h.going.includes(acc.id);
        if (b.status === "going" && !wasGoing && h.cap && h.going.length >= h.cap) return bad(`This one's full (room for ${h.cap}). Mark maybe and the host will see you're keen.`, 409);
        if (h.hostId === acc.id && b.status !== "going") return bad("You're hosting. Cancel the hang instead if it's off.");
        h.going = h.going.filter((x: string) => x !== acc.id);
        h.maybe = h.maybe.filter((x: string) => x !== acc.id);
        h.declined = h.declined.filter((x: string) => x !== acc.id);
        if (b.status === "going") h.going.push(acc.id);
        else if (b.status === "maybe") h.maybe.push(acc.id);
        else if (b.status === "cant") h.declined.push(acc.id);
        if ((b.status === "going" && !wasGoing) || (b.status === "cant" && wasGoing)) addFeed(g, { type: b.status === "going" ? "in" : "out", actor: acc.id, hangId: h.id });
        await saveCrew(g);
        return json({ crew: g });
      }

      if (M === "PATCH" && !p[4]) {
        if (h.hostId !== acc.id) return bad("Only the host can change this hang", 403);
        const { hang, error } = readHang(await body(req), g, acc.id);
        if (error) return bad(error);
        const fields = ["date", "time", "spot"].filter((k) => JSON.stringify((h as any)[k]) !== JSON.stringify((hang as any)[k]));
        if (hang.cap && h.going.length > hang.cap) return bad(`${h.going.length} people are already in. Set room for at least that many.`);
        Object.assign(h, hang, { editedAt: now() });
        if (fields.length) { h.changed = { fields, at: now() }; addFeed(g, { type: "edit", actor: acc.id, hangId: h.id, fields }); }
        await saveCrew(g);
        return json({ crew: g });
      }

      if (M === "DELETE" && !p[4]) {
        if (h.hostId !== acc.id) return bad("Only the host can cancel this hang", 403);
        g.hangs = g.hangs.filter((x: any) => x.id !== h.id);
        addFeed(g, { type: "cancel", actor: acc.id, title: h.title, date: h.date });
        await saveCrew(g);
        return json({ crew: g });
      }

      /* chat on a hang */
      if (M === "POST" && p[4] === "comment" && !p[5]) {
        const b = await body(req);
        const text = str(b.text, 400);
        if (!text) return bad("Write something first");
        h.comments = [...h.comments, { id: rid(8), by: acc.id, text, at: now() }].slice(-200);
        addFeed(g, { type: "comment", actor: acc.id, hangId: h.id, text: text.slice(0, 80) });
        await saveCrew(g);
        return json({ crew: g });
      }
      if (M === "DELETE" && p[4] === "comment" && p[5]) {
        const c = h.comments.find((x: any) => x.id === p[5]);
        if (!c) return json({ crew: g });
        if (c.by !== acc.id && h.hostId !== acc.id) return bad("You can only delete your own messages", 403);
        h.comments = h.comments.filter((x: any) => x.id !== c.id);
        await saveCrew(g);
        return json({ crew: g });
      }

      /* "who's bringing what" */
      if (M === "POST" && p[4] === "bring" && !p[5]) {
        const b = await body(req);
        const item = str(b.item, 60);
        if (!item) return bad("What should someone bring?");
        if (h.bring.length >= 20) return bad("That's a long list already");
        h.bring.push({ id: rid(8), item, addedBy: acc.id, claimedBy: b.mine ? acc.id : null });
        await saveCrew(g);
        return json({ crew: g });
      }
      if (M === "POST" && p[4] === "bring" && p[5] && p[6] === "claim") {
        const it = h.bring.find((x: any) => x.id === p[5]);
        if (!it) return bad("That item was removed", 404);
        if (it.claimedBy && it.claimedBy !== acc.id) return bad("Someone already has that covered");
        it.claimedBy = it.claimedBy === acc.id ? null : acc.id;
        await saveCrew(g);
        return json({ crew: g });
      }
      if (M === "DELETE" && p[4] === "bring" && p[5]) {
        const it = h.bring.find((x: any) => x.id === p[5]);
        if (it && it.addedBy !== acc.id && h.hostId !== acc.id) return bad("Only the host or whoever added it can remove it", 403);
        h.bring = h.bring.filter((x: any) => x.id !== p[5]);
        await saveCrew(g);
        return json({ crew: g });
      }
    }
  }

  return bad("Not found", 404);
}

export const config: Config = { path: "/api/*" };
