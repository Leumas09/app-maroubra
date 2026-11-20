// Formats partagés entre le hub (qui les produit) et l'app (qui les affiche).

export interface WeatherHour {
  t: number; // secondes Unix
  temp: number;
  feels: number;
  pop: number | null; // probabilité de pluie %
  precip: number; // mm
  code: number; // code météo WMO
  cloud: number;
  cloudLow: number;
  cloudMid: number;
  cloudHigh: number;
  wind: number; // km/h
  windDir: number;
  gust: number;
  uv: number;
  visibility: number | null; // m
  humidity: number;
}

export interface WeatherDay {
  t: number;
  code: number;
  max: number;
  min: number;
  precip: number;
  pop: number | null;
  uvMax: number;
  windMax: number;
  gustMax: number;
  windDir: number;
}

export interface Weather {
  current: { t: number; temp: number; feels: number; humidity: number; precip: number; code: number; cloud: number; wind: number; windDir: number; gust: number; uv: number; isDay: boolean };
  hourly: WeatherHour[];
  daily: WeatherDay[];
  rainPast24h: number;
}

export interface Metar {
  station: string;
  t: number;
  temp: number | null;
  dewpoint: number | null;
  windDir: number | null;
  windKt: number | null;
  gustKt: number | null;
  visibility: string | null;
  qnh: number | null;
  raw: string;
}

export interface MarineHour {
  t: number;
  waveHeight: number | null;
  waveDir: number | null;
  wavePeriod: number | null;
  swellHeight: number | null;
  swellDir: number | null;
  swellPeriod: number | null;
  windWaveHeight: number | null;
  sst: number | null;
}

export interface Marine {
  hourly: MarineHour[];
}

export interface BuoyObs {
  t: number;
  hs: number | null; // hauteur significative m
  hmax: number | null;
  tp: number | null; // période de pic s
  dir: number | null; // direction de provenance au pic
}

export interface Buoy {
  station: string;
  lat: number;
  lon: number;
  latest: BuoyObs | null;
  series: BuoyObs[]; // dernières 48 h
}

export interface Aircraft {
  hex: string;
  callsign: string | null;
  reg: string | null;
  type: string | null;
  /** Désignation lisible du type, quand la base d'adsb.lol la connaît (« BOEING 737-800 »). */
  desc: string | null;
  /** Catégorie ADS-B (A1 léger à A5 lourd, A7 hélicoptère, B1 planeur...). */
  category: string | null;
  operator: string | null;
  built: number | null; // année de construction
  altFt: number | null; // null au sol
  onGround: boolean;
  speedKt: number | null;
  track: number | null;
  vrate: number | null;
  lat: number;
  lon: number;
  /** Instant de la position (ms depuis 1970), pour l'extrapolation côté app. */
  posAt: number;
  /** Origine de la position : ADS-B, MLAT, TIS-B... */
  source: string | null;
  squawk: string | null;
  distKm: number;
  bearing: number;
  military: boolean;
  interesting: boolean;
  rare: string | null; // pourquoi il est remarquable
  emergency: string | null; // libellé lisible (« General emergency »)
  airline: Airline | null;
  /** Numéro de vol commercial déduit de l'indicatif (QFA1 donne QF1), seulement si la compagnie numérote ainsi. */
  flightNo: string | null;
  /** Route complète (codes) ; from et to désignent l'étape en cours. */
  route: { codes: string; from?: Airport; to?: Airport } | null;
  /** Avancement sur l'étape en cours, mesuré en distance (pas une prévision). */
  progress: { pct: number; flownKm: number; leftKm: number } | null;
  overhead: { inMin: number; closestKm: number } | null;
  trail: [number, number][];
}

export interface Airline {
  icao: string;
  iata: string;
  name: string;
  color: string;
}

export interface Airport {
  iata: string;
  icao?: string;
  name: string;
  location: string;
  lat?: number;
  lon?: number;
}

/** Photo d'un avion (Planespotters), affichée avec le nom du photographe et un lien vers la page d'origine. */
export interface AircraftPhoto {
  src: string;
  width: number;
  height: number;
  link: string;
  photographer: string;
}

export interface Flights {
  aircraft: Aircraft[];
  runway: { mode: string; confidence: "high" | "low" } | null;
  curfew: boolean;
  seenToday: number;
}

export interface Fire {
  id: string;
  title: string;
  alert: "Emergency Warning" | "Watch and Act" | "Advice" | "Not Applicable" | string;
  status: string;
  type: string;
  sizeHa: number | null;
  council: string;
  location: string;
  updated: string;
  lat: number;
  lon: number;
  distKm: number;
  bearing: number;
  smokeTowardUs: boolean;
}

export interface Fires {
  nearby: Fire[];
  totalNsw: number;
}

export interface AirQuality {
  current: { t: number; pm25: number | null; pm10: number | null; aqi: number | null; uv: number | null };
  hourly: { t: number; pm25: number | null; aqi: number | null }[];
  modelled: true;
}

export interface SpaceWeather {
  kpNow: number | null;
  kpMax24h: number | null;
  forecastMax: number | null;
  forecastAt: string | null;
  aurora: "none" | "camera" | "possible" | "likely";
}

export interface IssPass {
  start: string;
  max: string;
  end: string;
  maxAlt: number;
  startAz: number;
  endAz: number;
  durationMin: number;
}

export interface Iss {
  passes: IssPass[];
  tleEpoch: string;
}

export interface NewsItem {
  id: string;
  title: string;
  link: string;
  source: string;
  published: string;
  summary: string | null;
  topic: string | null;
  local: boolean | null;
}

export interface News {
  items: NewsItem[];
  triagedBy: "model" | "keywords";
}

export type BeachFactorKey = "surf" | "period" | "wind" | "water" | "air" | "rain" | "stormwater" | "tide" | "bluebottles" | "uv" | "official";

export interface BeachReason {
  key: BeachFactorKey;
  text: string;
  effect: "plus" | "minus" | "info";
  /** Points retirés au score de 10 (0 si le facteur n'enlève rien). */
  pts: number;
}

export interface SwimHour {
  t: number;
  score: number;
  surf: number | null; // m à la plage
  period: number | null; // s
  swellDir: number | null; // provenance, degrés
  wind: number; // km/h
  gust: number;
  windDir: number; // provenance, degrés
  side: "offshore" | "cross-shore" | "onshore";
  sst: number | null;
  feels: number;
  uv: number;
  pop: number | null;
  /** Points retirés par facteur, pour expliquer les écarts entre les heures. */
  pen: Partial<Record<BeachFactorKey, number>>;
}

export interface Beach {
  score: number; // 0 à 10
  label: "Great" | "Good" | "Fair" | "Poor" | "Stay out";
  reasons: BeachReason[];
  best: { start: number; end: number; score: number; because: string[]; still: string[] } | null;
  hours: SwimHour[];
  sea: { label: string; surfM: number | null; periodS: number | null; dir: number | null; wind: string; windKmh: number; gustKmh: number; windDir: number; side: SwimHour["side"] };
  bluebottles: boolean;
  afterRain: boolean;
  waterTemp: number | null;
  /** Normale à la plage (degrés) : la mer est de ce côté. */
  facing: number;
}

export interface Sunrise {
  date: string;
  time: string;
  score: number; // 0 à 10
  label: string;
  why: string;
}

export interface Moment {
  key: string;
  at: string;
  title: string;
  detail: string;
  kind: "sun" | "moon" | "dark" | "planet" | "iss" | "aurora" | "beach" | "rain" | "fire" | "plane" | "sea";
  priority: 1 | 2 | 3; // 1 = urgent
}

export interface Brief {
  text: string;
  at: string;
  by: "model" | "rules";
}

export interface SourceEntry<T = unknown> {
  ok: boolean;
  data: T | null;
  updatedAt: string | null;
  checkedAt: string | null;
  error: string | null;
  staleAfterMs: number;
}

export interface Snapshot {
  version: number;
  sources: Record<string, SourceEntry>;
}

/**
 * Statut officiel de la plage : rapport du matin des sauveteurs de Randwick City Council (flux RSS),
 * prévision de pollution Beachwatch (NSW), horaires de surveillance et note de danger Beachsafe (SLSA).
 * Chaque partie peut manquer : les sources sont indépendantes.
 */
export interface BeachStatus {
  status: "open" | "closed" | "unknown";
  /** Raison de la fermeture, tirée du texte des sauveteurs (houle, requin, pollution…). */
  reason: string | null;
  lifeguard: {
    summary: string | null;
    description: string | null;
    rips: string | null;
    bluebottles: string | null;
    waterTemp: string | null;
    waveHeight: string | null;
    at: string; // ISO, heure de publication
    today: boolean; // publié aujourd'hui (heure de Sydney)
    photo: string | null; // photo du matin publiée par la mairie
  } | null;
  patrol: { today: boolean; start: string | null; end: string | null } | null;
  hazard: number | null; // note Beachsafe de 1 à 10
  water: { forecast: "Unlikely" | "Possible" | "Likely" | null; latest: string | null; at: string | null } | null;
  errors: string[];
}
