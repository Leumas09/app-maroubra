// « Sky finder » : on lève le téléphone vers le ciel et chaque avion est nommé à sa place, sur l'image de la caméra.
// Direction du téléphone : capteurs d'orientation (boussole). Sans capteurs (ordinateur, tablette fixe),
// on regarde autour en glissant. Un glissement horizontal corrige aussi la boussole quand elle dévie.
import type { Aircraft } from "@maroubra/core";
import { useEffect, useRef, useState } from "react";
import { compass } from "../lib/format";
import { cameraAt, cameraAz, cameraEl, cameraFromOrientation, distanceKm, lookAngles, project, type Camera, type Motion } from "../lib/motion";
import { HOME, label } from "./FlightMap";

interface Orient { alpha: number; beta: number; gamma: number; heading: number | null; absolute: boolean }

type MotionPermission = { requestPermission?: () => Promise<"granted" | "denied"> };

/** iOS demande l'accord pour les capteurs, et seulement pendant un geste : à appeler dans le clic qui ouvre le viseur. */
export function requestMotion(): Promise<boolean> {
  const D = (window as unknown as { DeviceOrientationEvent?: MotionPermission }).DeviceOrientationEvent;
  if (typeof D?.requestPermission !== "function") return Promise.resolve(true);
  return D.requestPermission().then((r) => r === "granted").catch(() => false);
}

const fmtAlt = (ft: number) => `${ft.toLocaleString("en-AU")} ft`;

/** Champ de vue : le grand côté de l'écran couvre environ 66°, comme la caméra arrière d'un téléphone recadrée en plein écran. */
function vfovFor(w: number, h: number): number {
  const f = Math.max(w, h) / 2 / Math.tan((33 * Math.PI) / 180);
  return (2 * Math.atan(h / 2 / f) * 180) / Math.PI;
}

interface Props {
  aircraft: Aircraft[];
  motion: Motion;
  focus: string | null;
  onFocus: (hex: string) => void;
  onClose: () => void;
}

export function SkyFinder({ aircraft, motion, focus, onFocus, onClose }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const ori = useRef<Orient | null>(null);
  const view = useRef({ az: 0, el: 20, yaw: 0 });
  const obs = useRef({ lat: HOME[0], lon: HOME[1] });
  const state = useRef({ aircraft, focus });
  state.current = { aircraft, focus };
  const [mode, setMode] = useState<"starting" | "sensors" | "drag">("starting");
  const [camera, setCamera] = useState<"off" | "on" | "denied">("off");
  const [here, setHere] = useState<"home" | "you">("home");
  const [look, setLook] = useState<{ az: number; el: number }>({ az: 0, el: 20 });

  // Premier cadrage : vers l'avion choisi, sinon le plus proche en vol.
  useEffect(() => {
    const t = aircraft.find((a) => a.hex === focus) ?? aircraft.find((a) => !a.onGround && a.altFt != null);
    if (t?.altFt != null) {
      const l = lookAngles(obs.current, t.lat, t.lon, t.altFt);
      view.current.az = l.az;
      view.current.el = Math.min(60, Math.max(10, l.el));
    }
    closeBtn.current?.focus();
  }, []);

  // Capteurs d'orientation.
  useEffect(() => {
    let gotAbsolute = false;
    const onAbs = (e: DeviceOrientationEvent) => {
      if (e.alpha == null || e.beta == null || e.gamma == null) return;
      gotAbsolute = true;
      ori.current = { alpha: e.alpha, beta: e.beta, gamma: e.gamma, heading: null, absolute: true };
    };
    const onRel = (e: DeviceOrientationEvent) => {
      if (e.alpha == null || e.beta == null || e.gamma == null || gotAbsolute) return;
      const h = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
      ori.current = { alpha: e.alpha, beta: e.beta, gamma: e.gamma, heading: typeof h === "number" && h >= 0 ? h : null, absolute: e.absolute || typeof h === "number" };
    };
    window.addEventListener("deviceorientationabsolute" as "deviceorientation", onAbs);
    window.addEventListener("deviceorientation", onRel);
    const t = setTimeout(() => setMode(ori.current ? "sensors" : "drag"), 1200);
    return () => {
      clearTimeout(t);
      window.removeEventListener("deviceorientationabsolute" as "deviceorientation", onAbs);
      window.removeEventListener("deviceorientation", onRel);
    };
  }, []);

  // Caméra arrière, si le navigateur la donne.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((s) => {
        if (stopped) { s.getTracks().forEach((x) => x.stop()); return; }
        stream = s;
        if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}); }
        setCamera("on");
      })
      .catch(() => setCamera("denied"));
    return () => { stopped = true; stream?.getTracks().forEach((x) => x.stop()); };
  }, []);

  // Position de l'observateur : la sienne si elle est à moins de 40 km, sinon la maison.
  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        if (distanceKm(p.coords.latitude, p.coords.longitude, HOME[0], HOME[1]) > 40) return;
        obs.current = { lat: p.coords.latitude, lon: p.coords.longitude };
        setHere("you");
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60e3 },
    );
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const v = view.current;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") v.az = (v.az - 5 + 360) % 360, v.yaw -= 2;
      else if (e.key === "ArrowRight") v.az = (v.az + 5) % 360, v.yaw += 2;
      else if (e.key === "ArrowUp") v.el = Math.min(89, v.el + 5);
      else if (e.key === "ArrowDown") v.el = Math.max(-10, v.el - 5);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const cam = (): Camera => {
    const o = ori.current, v = view.current;
    if (mode === "sensors" && o) {
      const screenAngle = screen.orientation?.angle ?? 0;
      return cameraFromOrientation(o.alpha, o.beta, o.gamma, { heading: o.heading, screenAngle, yawOffset: v.yaw });
    }
    return cameraAt(v.az, v.el);
  };

  // Projections de la dernière image, pour le toucher.
  const hits = useRef<{ hex: string; x: number; y: number }[]>([]);

  useEffect(() => {
    let raf = 0, last = 0, lastLook = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 33) return;
      last = now;
      const cv = canvas.current;
      if (!cv) return;
      const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
      if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      const ctx = cv.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const c = cam();
      const vfov = vfovFor(w, h);
      // Couleurs fixes, lisibles sur le ciel comme sur l'image de la caméra, de jour comme de nuit.
      const ink = "#fff", accent = "#FFD84D", alert = "#FF7A66", sun = "#FFC48A";
      ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 4;

      // Horizon et repères de hauteur.
      for (const el of [0, 30, 60]) {
        ctx.beginPath();
        let pen = false;
        for (let az = 0; az <= 360; az += 2) {
          const p = project(c, az, el, w, h, vfov);
          if (!p) { pen = false; continue; }
          pen ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
          pen = true;
        }
        ctx.strokeStyle = ink; ctx.globalAlpha = el === 0 ? 0.8 : 0.3; ctx.lineWidth = el === 0 ? 1.5 : 1;
        ctx.setLineDash(el === 0 ? [] : [3, 6]); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        if (el > 0) {
          const p = project(c, cameraAz(c), el, w, h, vfov);
          if (p?.inView) { ctx.font = "500 11px 'Figtree Variable', system-ui"; ctx.fillStyle = ink; ctx.globalAlpha = 0.6; ctx.fillText(`${el}°`, p.x + 4, p.y - 4); ctx.globalAlpha = 1; }
        }
      }
      for (let az = 0; az < 360; az += 15) {
        const p = project(c, az, 0, w, h, vfov);
        if (!p?.inView) continue;
        const card = az % 90 === 0;
        ctx.beginPath(); ctx.moveTo(p.x, p.y - (card ? 10 : 5)); ctx.lineTo(p.x, p.y + (card ? 10 : 5));
        ctx.strokeStyle = ink; ctx.lineWidth = card ? 2 : 1; ctx.stroke();
        ctx.font = card ? "800 16px 'Figtree Variable', system-ui" : "500 12px 'Figtree Variable', system-ui";
        ctx.fillStyle = ink; ctx.textAlign = "center";
        ctx.fillText(card ? ["N", "E", "S", "W"][az / 90] : `${az}°`, p.x, p.y - 14);
        ctx.textAlign = "start";
      }

      // Avions.
      const t = Date.now();
      const { aircraft: list, focus: f } = state.current;
      const shown: typeof hits.current = [];
      let focusOff: { side: "left" | "right" | "up" | "down"; a: Aircraft } | null = null;
      for (const a of list) {
        if (a.onGround || a.altFt == null) continue;
        const pos = motion.pos(a.hex, t);
        if (!pos) continue;
        const l = lookAngles(obs.current, pos[0], pos[1], a.altFt);
        if (l.el < -1) continue;
        const p = project(c, l.az, l.el, w, h, vfov);
        const on = a.hex === f;
        if (!p || !p.inView) {
          if (on) {
            const rel = ((l.az - cameraAz(c) + 540) % 360) - 180;
            focusOff = { a, side: p && p.y < 0 ? "up" : p && p.y > h ? "down" : rel < 0 ? "left" : "right" };
          }
          continue;
        }
        shown.push({ hex: a.hex, x: p.x, y: p.y });
        const color = a.emergency ? alert : on ? accent : a.interesting ? sun : ink;
        ctx.beginPath(); ctx.arc(p.x, p.y, on ? 13 : 9, 0, Math.PI * 2);
        ctx.strokeStyle = color; ctx.lineWidth = on ? 3 : 2; ctx.stroke();
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
        // Étiquette : plus l'avion est proche, plus elle est détaillée.
        ctx.font = `800 ${on ? 17 : 14}px 'Figtree Variable', system-ui`;
        ctx.fillStyle = color;
        ctx.fillText(`${label(a)}${a.type ? `  ${a.type}` : ""}`, p.x + 16, p.y - 2);
        ctx.font = "500 12px 'Figtree Variable', system-ui";
        ctx.fillStyle = ink;
        ctx.fillText(`${l.distKm.toFixed(1)} km · ${fmtAlt(a.altFt)}${a.route?.to ? ` · to ${a.route.to.iata}` : ""}`, p.x + 16, p.y + 14);
      }
      hits.current = shown;
      if (focusOff) {
        const { side, a } = focusOff;
        const x = side === "left" ? 28 : side === "right" ? w - 28 : w / 2, y = side === "up" ? 90 : side === "down" ? h - 150 : h / 2;
        const ang = { left: Math.PI, right: 0, up: -Math.PI / 2, down: Math.PI / 2 }[side];
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
        ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -12); ctx.lineTo(-8, 12); ctx.closePath();
        ctx.fillStyle = accent; ctx.fill(); ctx.restore();
        ctx.font = "800 14px 'Figtree Variable', system-ui"; ctx.fillStyle = ink;
        ctx.textAlign = side === "right" ? "end" : side === "left" ? "start" : "center";
        ctx.fillText(label(a), side === "right" ? x - 22 : side === "left" ? x + 22 : x, side === "up" ? y + 30 : side === "down" ? y - 22 : y + 5);
        ctx.textAlign = "start";
      }
      if (now - lastLook > 250) { lastLook = now; setLook({ az: cameraAz(c), el: cameraEl(c) }); }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  // Glisser : regarder autour (sans capteurs) ou caler la boussole (avec).
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const down = (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; (e.target as Element).setPointerCapture(e.pointerId); };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    const cv = canvas.current!;
    const vfov = vfovFor(cv.clientWidth, cv.clientHeight);
    const degPx = vfov / cv.clientHeight;
    if (mode === "sensors") view.current.yaw -= dx * degPx;
    else {
      view.current.az = (view.current.az - dx * degPx + 360) % 360;
      view.current.el = Math.max(-10, Math.min(89, view.current.el + dy * degPx));
    }
    d.x = e.clientX; d.y = e.clientY;
  };
  const up = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const r = canvas.current!.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const best = hits.current.map((p) => ({ ...p, d: Math.hypot(p.x - x, p.y - y) })).filter((p) => p.d < 44).sort((a, b) => a.d - b.d)[0];
    if (best) onFocus(best.hex);
  };

  const f = aircraft.find((a) => a.hex === focus && !a.onGround);
  const fl = f?.altFt != null ? (() => { const p = motion.pos(f.hex, Date.now()) ?? [f.lat, f.lon]; return lookAngles(obs.current, p[0], p[1], f.altFt!); })() : null;
  const hint = mode === "starting" ? "Starting sensors…"
    : mode === "sensors" ? "Hold your phone up to the sky. If labels sit beside the real aircraft, drag sideways to line them up."
      : "No motion sensors here: drag to look around, or use the arrow keys.";

  return (
    <div className="skyfinder" role="dialog" aria-modal="true" aria-label="Sky finder: aircraft labelled in the sky">
      <video ref={video} className="skyfinder-video" playsInline muted aria-hidden="true" hidden={camera !== "on"} />
      <canvas ref={canvas} className="skyfinder-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; }}
        aria-label="Sky view. Tap an aircraft to pick it." role="img" />
      <div className="skyfinder-top">
        <div>
          <strong>Sky finder</strong>
          <span className="skyfinder-dir">Looking {compass(look.az)} ({Math.round(look.az)}°), {Math.round(look.el)}° up</span>
        </div>
        <button ref={closeBtn} className="btn ghost" onClick={onClose}>Close</button>
      </div>
      <div className="skyfinder-bottom" aria-live="polite">
        {f && fl ? (
          <p className="skyfinder-focus">
            <strong>{label(f)}</strong>{f.airline ? ` ${f.airline.name}` : ""}{f.route ? `, ${f.route.codes}` : ""}.
            {" "}Look {compass(fl.az)}, {Math.max(0, Math.round(fl.el))}° above the horizon, {fl.distKm.toFixed(1)} km away.
          </p>
        ) : <p className="skyfinder-focus">Tap an aircraft to pick it.</p>}
        <p className="skyfinder-hint">
          {hint}{camera === "denied" ? " Camera unavailable: showing the sky grid only." : ""}{here === "you" ? " Using your location." : " Seen from home."}
        </p>
      </div>
    </div>
  );
}
