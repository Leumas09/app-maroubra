// Compagnies vues à Sydney : code OACI de l'indicatif, code IATA du numéro de vol, nom et couleur de marque
// (approchée, pour une pastille, pas un logo). `fn: false` quand le numéro de l'indicatif n'est pas le
// numéro de vol commercial (filiales régionales qui volent sous le code QF avec une autre numérotation).
import type { Airline } from "@maroubra/core";

type Row = [icao: string, iata: string, name: string, color: string, fn?: false];

const ROWS: Row[] = [
  ["QFA", "QF", "Qantas", "#E40000"],
  ["QLK", "QF", "QantasLink", "#E40000", false],
  ["EAQ", "QF", "QantasLink", "#E40000", false],
  ["SSQ", "QF", "QantasLink", "#E40000", false],
  ["NWK", "QF", "Network Aviation (Qantas)", "#E40000", false],
  ["JST", "JQ", "Jetstar", "#FF5B00"],
  ["JSA", "3K", "Jetstar Asia", "#FF5B00"],
  ["JJP", "GK", "Jetstar Japan", "#FF5B00"],
  ["VOZ", "VA", "Virgin Australia", "#C8102E"],
  ["RXA", "ZL", "Rex", "#F26522"],
  ["UTY", "QQ", "Alliance Airlines", "#003B70"],
  ["ANO", "TL", "Airnorth", "#F7941D"],
  ["ANZ", "NZ", "Air New Zealand", "#111111"],
  ["FJI", "FJ", "Fiji Airways", "#00335F"],
  ["ANG", "PX", "Air Niugini", "#DA291C"],
  ["ACI", "SB", "Aircalin", "#00A3AD"],
  ["THT", "TN", "Air Tahiti Nui", "#00A3E0"],
  ["SIA", "SQ", "Singapore Airlines", "#1A2B5F"],
  ["TGW", "TR", "Scoot", "#E6B800"],
  ["UAE", "EK", "Emirates", "#D71921"],
  ["QTR", "QR", "Qatar Airways", "#5C0632"],
  ["ETD", "EY", "Etihad", "#BD8B13"],
  ["THY", "TK", "Turkish Airlines", "#C70A0C"],
  ["CPA", "CX", "Cathay Pacific", "#006564"],
  ["CES", "MU", "China Eastern", "#00387D"],
  ["CSN", "CZ", "China Southern", "#3A86C8"],
  ["CCA", "CA", "Air China", "#E30613"],
  ["CHH", "HU", "Hainan Airlines", "#C8102E"],
  ["CSC", "3U", "Sichuan Airlines", "#B5121B"],
  ["CXA", "MF", "Xiamen Airlines", "#0057A8"],
  ["JAL", "JL", "Japan Airlines", "#CC0000"],
  ["ANA", "NH", "ANA", "#13448F"],
  ["KAL", "KE", "Korean Air", "#00A3E0"],
  ["AAR", "OZ", "Asiana", "#8B7D6B"],
  ["EVA", "BR", "EVA Air", "#00694F"],
  ["CAL", "CI", "China Airlines", "#B0005A"],
  ["MAS", "MH", "Malaysia Airlines", "#003B7A"],
  ["MXD", "OD", "Batik Air Malaysia", "#D7182A"],
  ["XAX", "D7", "AirAsia X", "#E40000"],
  ["THA", "TG", "Thai Airways", "#5C2D91"],
  ["GIA", "GA", "Garuda Indonesia", "#0089CF"],
  ["PAL", "PR", "Philippine Airlines", "#003D7E"],
  ["CEB", "5J", "Cebu Pacific", "#E6B800"],
  ["VJC", "VJ", "VietJet", "#E20019"],
  ["HVN", "VN", "Vietnam Airlines", "#00677F"],
  ["RBA", "BI", "Royal Brunei", "#C9A227"],
  ["AIC", "AI", "Air India", "#DA0E29"],
  ["IGO", "6E", "IndiGo", "#001B94"],
  ["ALK", "UL", "SriLankan Airlines", "#003C71"],
  ["UAL", "UA", "United", "#002244"],
  ["AAL", "AA", "American Airlines", "#0078D2"],
  ["DAL", "DL", "Delta", "#003366"],
  ["ACA", "AC", "Air Canada", "#F01428"],
  ["HAL", "HA", "Hawaiian Airlines", "#413691"],
  ["LAN", "LA", "LATAM", "#1B0088"],
  ["SAA", "SA", "South African Airways", "#00205B"],
  ["FDX", "FX", "FedEx", "#4D148C"],
  ["UPS", "5X", "UPS", "#351C15"],
  ["GTI", "5Y", "Atlas Air", "#00205B"],
];

const BY_ICAO = new Map(ROWS.map(([icao, iata, name, color, fn]) => [icao, { airline: { icao, iata, name, color } as Airline, fn: fn !== false }]));

/** Compagnie et numéro de vol commercial à partir de l'indicatif (« QFA1 » donne Qantas et « QF1 »). */
export function airlineOf(callsign: string | null): { airline: Airline | null; flightNo: string | null } {
  const m = callsign?.match(/^([A-Z]{3})(\d{1,4}[A-Z]{0,2})$/);
  const hit = m ? BY_ICAO.get(m[1]) : undefined;
  if (!m || !hit) return { airline: null, flightNo: null };
  const num = m[2].replace(/^0+(?=\d)/, "");
  return { airline: hit.airline, flightNo: hit.fn && /^\d+$/.test(num) ? `${hit.airline.iata}${num}` : null };
}
