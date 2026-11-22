import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { compress } from "hono/compress";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Auth, clientIp, COOKIE, LoginLimiter } from "./auth";
import type { Config } from "./config";
import { loginPage } from "./login-page";
import type { Aircraft } from "@maroubra/core";
import type { PhotoFinder } from "./photos";
import type { FlightHistory } from "./sources/history";
import type { Push } from "./push";
import type { Store } from "./store";
// Numéro de version de l'app (package.json racine), incrémenté à chaque mise en production.
import { version as release } from "../../../package.json";

/** Container Apps coupe une requête HTTP au bout de 240 s : on ferme le flux avant, le client se reconnecte. */
export const SSE_MAX_MS = 200_000;
const SSE_HEARTBEAT_MS = 15_000;

export interface Vote { date: string; value: number; voter: string }

/** Hôtes d'images externes : webcams de Randwick, fonds de carte (OpenStreetMap, Esri), photos d'avions (Planespotters, airport-data.com, Wikimedia). */
const IMG_HOSTS = "https://www.randwick.nsw.gov.au https://tile.openstreetmap.org https://server.arcgisonline.com https://*.plnspttrs.net https://*.planespotters.net " +
  "https://image.airport-data.com https://airport-data.com https://upload.wikimedia.org https://thumb.wikimedia.org https://*.secdn.net";
/** Flux vidéo des webcams de Randwick (HLS, servi par secdn.net). */
const MEDIA_HOSTS = "https://*.secdn.net";

export function createApp(cfg: Config, store: Store, deps: { push?: Push; vote?: (v: Vote) => Promise<void>; satellite?: () => Buffer | null; photos?: PhotoFinder; area?: (lat: number, lon: number, nm: number) => Promise<Aircraft[]>; history?: FlightHistory } = {}) {
  const app = new Hono();
  const auth = new Auth(cfg.password!, cfg.sessionSecret);
  const limiter = new LoginLimiter();
  const indexPath = join(cfg.staticDir, "index.html");

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "same-origin");
    if (cfg.secureCookies) c.header("Strict-Transport-Security", "max-age=31536000");
    c.header(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${IMG_HOSTS}; ` +
        `font-src 'self' data:; connect-src 'self' ${MEDIA_HOSTS}; media-src 'self' blob: ${MEDIA_HOSTS}; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
    );
  });

  // Compression gzip des réponses, sauf le flux temps réel (qui doit partir sans tampon).
  const gzip = compress();
  app.use("*", (c, next) => (c.req.path === "/api/stream" ? next() : gzip(c, next)));

  // Public : santé (sans donnée), page de connexion, icône et service worker.
  app.get("/health", (c) => c.json({ status: "ok", release, version: cfg.version, sources: store.health() }));
  for (const f of ["/icon.svg", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest", "/sw.js"]) app.get(f, serveStatic({ root: cfg.staticDir }));
  app.get("/login", (c) => c.html(loginPage({ next: c.req.query("next") })));

  app.post("/login", async (c) => {
    const ip = clientIp(c.req.header("x-forwarded-for"), "local");
    const wait = limiter.retryAfterSeconds(ip);
    if (wait > 0) {
      c.header("Retry-After", String(wait));
      return c.html(loginPage({ error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.` }), 429);
    }
    const form = await c.req.parseBody();
    const password = typeof form.password === "string" ? form.password : "";
    const next = typeof form.next === "string" ? form.next : "/";
    if (!auth.checkPassword(password)) {
      limiter.fail(ip);
      await new Promise((r) => setTimeout(r, 400));
      console.warn(JSON.stringify({ event: "login_failed", ip }));
      return c.html(loginPage({ error: "Wrong password.", next }), 401);
    }
    limiter.success(ip);
    const { token, maxAgeSeconds } = auth.issue(form.remember === "1");
    setCookie(c, COOKIE, token, { httpOnly: true, secure: cfg.secureCookies, sameSite: "Lax", path: "/", maxAge: maxAgeSeconds });
    return c.redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/", 303);
  });

  app.post("/logout", (c) => {
    deleteCookie(c, COOKIE, { path: "/" });
    return c.redirect("/login", 303);
  });

  // Tout le reste exige une session.
  app.use("*", async (c, next) => {
    if (auth.verify(getCookie(c, COOKIE))) return next();
    if (c.req.path.startsWith("/api/")) return c.json({ error: "unauthorized" }, 401);
    return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`, 303);
  });

  // Requêtes qui modifient quelque chose : même origine obligatoire.
  app.use("/api/*", async (c, next) => {
    if (c.req.method !== "GET") {
      const origin = c.req.header("origin");
      const host = c.req.header("host");
      if (origin && host && new URL(origin).host !== host) return c.json({ error: "bad origin" }, 403);
    }
    return next();
  });

  app.get("/api/state", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ ...store.snapshot(), build: cfg.version });
  });

  app.get("/api/stream", (c) => {
    c.header("Cache-Control", "no-cache");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      const snap = store.snapshot();
      // build : version servie ; l'app se recharge seule quand elle change (écran ambiant resté ouvert).
      await stream.writeSSE({ event: "snapshot", data: JSON.stringify({ ...snap, build: cfg.version }), id: String(snap.version), retry: 1000 });
      const queue: string[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = store.subscribe((id, entry, version) => {
        queue.push(JSON.stringify({ id, entry, version }));
        wake?.();
      });
      const started = Date.now();
      stream.onAbort(() => { unsubscribe(); wake?.(); });
      try {
        while (!stream.aborted && Date.now() - started < SSE_MAX_MS) {
          while (queue.length) await stream.writeSSE({ event: "patch", data: queue.shift()! });
          await new Promise<void>((r) => { wake = r; setTimeout(r, SSE_HEARTBEAT_MS); });
          wake = null;
          if (!queue.length) await stream.write(": keep-alive\n\n");
        }
      } finally {
        unsubscribe();
      }
    });
  });

  // Dernière image satellite des nuages (Himawari-9), calculée par le hub.
  app.get("/api/satellite.png", (c) => {
    const png = deps.satellite?.();
    if (!png) return c.json({ error: "no image yet" }, 404);
    c.header("Cache-Control", "private, max-age=300");
    return c.body(new Uint8Array(png), 200, { "Content-Type": "image/png" });
  });

  // Vote du matin sur le lever de soleil : le juge du score de lever de soleil.
  app.post("/api/vote", async (c) => {
    const body = await c.req.json().catch(() => null);
    const date = String(body?.date ?? "");
    const value = Number(body?.value);
    const voter = String(body?.voter ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || ![0, 1, 2].includes(value) || !voter || voter.length > 64) return c.json({ error: "bad vote" }, 400);
    // Un vote par appareil et par matin, seulement pour hier ou aujourd'hui (jour de Sydney).
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
    const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date(Date.now() - 86400e3));
    if (date !== today && date !== yesterday) return c.json({ error: "too late" }, 400);
    const id = createHash("sha256").update(voter).digest("hex").slice(0, 16);
    await deps.vote?.({ date, value, voter: id });
    return c.json({ ok: true });
  });

  // Avions d'une zone (centre et rayon en milles nautiques), quand la carte sort des environs de la maison.
  app.get("/api/aircraft/area", async (c) => {
    const lat = Number(c.req.query("lat")), lon = Number(c.req.query("lon")), r = Number(c.req.query("r"));
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && r > 0 && r <= 1000)) return c.json({ error: "bad area" }, 400);
    c.header("Cache-Control", "no-store");
    if (!deps.area) return c.json({ aircraft: [] });
    try {
      return c.json({ aircraft: await deps.area(lat, lon, r) });
    } catch (err) {
      return c.json({ error: String((err as Error).message ?? err) }, 502);
    }
  });

  // Trace complète d'un avion (jusqu'à 3 h) et heure de décollage, pour l'avion choisi sur la carte.
  app.get("/api/aircraft/:hex/trace", (c) => {
    const hex = c.req.param("hex").toLowerCase();
    if (!/^~?[0-9a-f]{6}$/.test(hex)) return c.json({ error: "bad aircraft" }, 400);
    c.header("Cache-Control", "no-store");
    return c.json({ points: deps.history?.trace(hex) ?? [], tookOffAt: deps.history?.tookOffAt(hex) ?? null });
  });

  // Photo d'un avion, à la demande (clic sur l'avion) : adresse OACI à 6 chiffres hexadécimaux, immatriculation facultative.
  app.get("/api/aircraft/:hex/photo", async (c) => {
    const hex = c.req.param("hex").toLowerCase();
    const reg = c.req.query("reg")?.toUpperCase() ?? null;
    const type = c.req.query("type")?.trim() || null;
    if (!/^[0-9a-f]{6}$/.test(hex) || (reg && !/^[A-Z0-9-]{2,10}$/.test(reg)) || (type && !/^[\w .\-/()]{2,60}$/.test(type))) return c.json({ error: "bad aircraft" }, 400);
    if (!deps.photos) return c.json({ photo: null });
    const photo = await deps.photos(hex, reg, type).catch(() => null);
    c.header("Cache-Control", "private, max-age=86400");
    return c.json({ photo });
  });

  if (deps.push) {
    const push = deps.push;
    app.get("/api/push/key", (c) => c.json({ publicKey: push.publicKey }));
    app.post("/api/push/subscribe", async (c) => {
      const body = await c.req.json().catch(() => null);
      if (!body?.subscription?.endpoint) return c.json({ error: "subscription required" }, 400);
      await push.subscribe(body.subscription, body.prefs ?? {});
      return c.json({ ok: true });
    });
    app.post("/api/push/unsubscribe", async (c) => {
      const body = await c.req.json().catch(() => null);
      if (body?.endpoint) await push.unsubscribe(body.endpoint);
      return c.json({ ok: true });
    });
    app.post("/api/push/test", async (c) => {
      const body = await c.req.json().catch(() => null);
      const sent = body?.endpoint ? await push.test(body.endpoint) : false;
      return c.json({ ok: sent });
    });
  }

  // Fichiers de l'app : ressources versionnées en cache long, page d'entrée jamais en cache.
  app.use("/assets/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "public, max-age=31536000, immutable");
  });
  app.use("*", serveStatic({ root: cfg.staticDir }));
  app.get("*", (c: Context) => {
    if (!existsSync(indexPath)) return c.text("App not built", 503);
    c.header("Cache-Control", "no-cache");
    return c.html(readFileSync(indexPath, "utf8"));
  });

  return app;
}
