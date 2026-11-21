// Applique à la prévision affichée la correction apprise en ligne (derive/verify.ts), seulement si
// elle bat le modèle brut sur la fenêtre de contrôle. Les valeurs brutes restent dans tempRaw et windRaw,
// et c'est elles que l'archive garde : on ne juge jamais une correction avec ses propres sorties.
import type { CorrectionState, Verification, Weather } from "@maroubra/core";
import { smoothBias, sydneyHour } from "./verify";

const localDay = (tS: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(tS * 1000);

function biasAt(c: CorrectionState, leadH: number, validS: number): number {
  return smoothBias((b, h) => c.bias[b]?.[h] ?? 0, leadH, sydneyHour(validS));
}

export function applyCorrection(w: Weather, v: Verification | null, now = Date.now()): Weather {
  const ct = v?.correction.temp, cw = v?.correction.wind;
  const onT = !!ct?.on, onW = !!cw?.on;
  if (!onT && !onW) return w;
  const nowS = now / 1000;
  const hourly = w.hourly.map((h) => {
    const lead = (h.t - nowS) / 3600;
    if (lead < 0 || lead >= 49) return h;
    const dT = onT ? biasAt(ct!, lead, h.t) : 0;
    const dW = onW ? biasAt(cw!, lead, h.t) : 0;
    return {
      ...h,
      ...(onT ? { temp: Math.round((h.temp - dT) * 10) / 10, feels: Math.round((h.feels - dT) * 10) / 10, tempRaw: h.temp } : {}),
      ...(onW ? { wind: Math.max(0, Math.round(h.wind - dW)), windRaw: h.wind } : {}),
    };
  });
  // Les extrêmes du jour suivent l'écart entre le maximum (minimum) horaire corrigé et brut.
  const daily = w.daily.map((d) => {
    const day = localDay(d.t + 12 * 3600);
    const hs = hourly.filter((h) => localDay(h.t) === day && h.tempRaw != null);
    if (!hs.length) return d;
    const dMax = Math.max(...hs.map((h) => h.temp)) - Math.max(...hs.map((h) => h.tempRaw!));
    const dMin = Math.min(...hs.map((h) => h.temp)) - Math.min(...hs.map((h) => h.tempRaw!));
    return { ...d, max: Math.round((d.max + dMax) * 10) / 10, min: Math.round((d.min + dMin) * 10) / 10 };
  });
  // L'instant présent suit la correction à échéance nulle, pour rester cohérent avec la courbe.
  const c = w.current;
  const dT0 = onT ? biasAt(ct!, 0, c.t) : 0;
  const current = onT ? { ...c, temp: Math.round((c.temp - dT0) * 10) / 10, feels: Math.round((c.feels - dT0) * 10) / 10 } : c;
  const parts = [onT ? `temperature ${ct!.why.toLowerCase()}` : null, onW ? `wind ${cw!.why.toLowerCase()}` : null].filter(Boolean);
  return { ...w, current, hourly, daily, corrected: { temp: onT, wind: onW, note: `Corrected for Maroubra: ${parts.join("; ")}.` } };
}
