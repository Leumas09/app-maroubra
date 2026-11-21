// Silhouettes vues de dessus, nez vers le haut, dans une boîte de 32 × 32, et choix selon le type OACI
// ou, à défaut, la catégorie ADS-B. La taille à l'écran suit la taille réelle de l'avion.
import type { Aircraft } from "@maroubra/core";

export type Shape = "heavy" | "wide" | "narrow" | "rearjet" | "turboprop" | "light" | "heli" | "glider" | "fighter";

const jet = (span: number, body: number, engines: number[]) => {
  const l = 16 - span, r = 16 + span, bl = 16 - body, br = 16 + body;
  const wing = `M16 1.5C${16 + body * 0.7} 1.5 ${br} 3 ${br} 5L${br} 12L${r} 18.5L${r} 20.5L${br} 17.5L${br - 0.2} 25L21.5 28.2L21.5 30L16 28.8L10.5 30L10.5 28.2L${bl + 0.2} 25L${bl} 17.5L${l} 20.5L${l} 18.5L${bl} 12L${bl} 5C${bl} 3 ${16 - body * 0.7} 1.5 16 1.5Z`;
  // Moteurs sous l'aile : la flèche fait reculer les plus éloignés du fuselage.
  const eng = engines.map((x) => { const y = 12 + ((Math.abs(x - 16) - body) / (span - body)) * 6.5 - 2.6; return `M${x - 1.1} ${y}h2.2v3.4h-2.2Z`; }).join("");
  return wing + eng;
};

export const SHAPES: Record<Shape, string> = {
  heavy: jet(15.5, 2.4, [5.2, 10, 22, 26.8]),
  wide: jet(15, 2.1, [9, 23]),
  narrow: jet(13.5, 1.6, [10, 22]),
  rearjet: "M16 2C17 2 17.3 3.5 17.3 5L17.3 12L27 17.5L27 19L17.3 16.5L17.2 22.5L19.8 22.5L19.8 26.2L17.2 26.2L17.1 26.5L21.5 29L21.5 30.5L16 29.5L10.5 30.5L10.5 29L14.9 26.5L14.8 26.2L12.2 26.2L12.2 22.5L14.8 22.5L14.7 16.5L5 19L5 17.5L14.7 12L14.7 5C14.7 3.5 15 2 16 2Z",
  turboprop: "M16 3C17 3 17.3 4.5 17.3 6L17.3 11L30 11.5L30 14L17.3 14.5L17.1 26L21.5 27.5L21.5 29.5L16 29L10.5 29.5L10.5 27.5L14.9 26L14.7 14.5L2 14L2 11.5L14.7 11L14.7 6C14.7 4.5 15 3 16 3ZM9 7.5h2v7h-2ZM21 7.5h2v7h-2ZM6.5 7h7v1h-7ZM18.5 7h7v1h-7Z",
  light: "M16 4.5C17 4.5 17.2 6 17.2 7L17.2 10.5L29 11L29 13.5L17.2 14L16.8 25L20.5 26L20.5 28L16 27.6L11.5 28L11.5 26L15.2 25L14.8 14L3 13.5L3 11L14.8 10.5L14.8 7C14.8 6 15 4.5 16 4.5ZM12.5 3.5h7v1h-7Z",
  heli: "M16 8C18.4 8 19.2 10.5 19.2 13.5C19.2 17 18 19 16.7 19.6L16.6 28.5L19 28.5L19 29.7L13 29.7L13 28.5L15.4 28.5L15.3 19.6C14 19 12.8 17 12.8 13.5C12.8 10.5 13.6 8 16 8ZM4.2 3.4L5 2.6L28.8 26.4L28 27.2ZM27.8 2.6L28.6 3.4L4.8 27.2L4 26.4Z",
  glider: "M16 4C16.8 4 17 5.5 17 7L17 11.2L31.5 12.2L31.5 13.6L17 14L16.6 27.5L20 28.2L20 29.6L16 29.4L12 29.6L12 28.2L15.4 27.5L15 14L0.5 13.6L0.5 12.2L15 11.2L15 7C15 5.5 15.2 4 16 4Z",
  fighter: "M16 1L17.8 8.5L17.8 13.5L28.5 23.5L28.5 25.5L17.8 23.5L17.8 26.5L21.5 29.5L21.5 31L16 30L10.5 31L10.5 29.5L14.2 26.5L14.2 23.5L3.5 25.5L3.5 23.5L14.2 13.5L14.2 8.5Z",
};

/** Taille à l'écran (px) de la boîte de 32 unités. */
export const SIZE: Record<Shape, number> = { heavy: 38, wide: 34, narrow: 28, rearjet: 24, turboprop: 25, light: 20, heli: 24, glider: 22, fighter: 24 };

const RULES: [RegExp, Shape][] = [
  [/^(A38\d|B74\d|B74[RS]|A34[2-6]|A124|A225|IL96|IL76|B52|K35R|C17|A400|E3[CT]F|KC10)$/, "heavy"],
  [/^(A30[0-9B]|A31\d|A33\d|A35\d|A35K|B76\d|B77\d|B77[LW]|B78\d|B78X|MD11|DC10|L101|KC46)$/, "wide"],
  [/^(CRJ\d|E13\d|E14\d|E145|F70|F100|B712|MD8\d|MD9\d|DC9\d?|C25[A-C]?|C5\d\d?|C56X|C68A|C700|C750|GLF\d|GLEX|GL5T|GL7T|CL30|CL35|CL60|FA\d\d?X?|F2TH|F900|LJ\d\d|H25B|E5[05]P|E545|E550|PC24|HDJT|BE40|PRM1|SBR\d)$/, "rearjet"],
  [/^(DH8[A-D]|AT[4-7]\d|SF34|SB20|JS\d\d|B190|BE[29]\d|BE20|B350|PC12|PC21|C208|DHC[67]|D228|D328|E120|F50|SW[34]|C130|C30J|L188|P3|AN2[46]|SH36|C27J|TBM\d|KODI|AC9\d|P180|B200)$/, "turboprop"],
  [/^(EC\d\d|AS3\d|AS5\d|AS65|H1[2-6]\d?|H1[2-6]|R22|R44|R66|B06|B05|B407|B412|B429|B47G|A1[0-8]9|A139|AW\d+|S76|S92|NH90|H60|MH60|UH1|BK17|EXPL|MD5\d\d?|MI8|EH10|LYNX)$/, "heli"],
  [/^(GLID|ASK\d+|DG\d+|LS\d|DUOD|ARCP|NIMB|VENT|JANU|DISC)$/, "glider"],
  [/^(F35|FA18|F18[A-H]?|F16|F15|F22|EUFI|RFAL|HAWK|F5|MG\d\d|SU\d\d|J10|GRIF|M346|L39|T6)$/, "fighter"],
  [/^(C1[5-9]\d|C2[01]\d|C82[RT]?|C77R|C72R|P28[ABRTU]?|PA\d\d|SR2[02]|DA[24]\d?|BE3[356]|BE76|M20[PT]?|AA5|RV\d+|G115|TB[12]\d?|J3|PC6|GA8|AT3|C42|EV97|SAVA|CH\d\d|RANS|TECN|S22T|P68|C310|C340|C421|DR40)$/, "light"],
];

const BY_CATEGORY: Record<string, Shape> = { A1: "light", A2: "rearjet", A3: "narrow", A4: "narrow", A5: "wide", A6: "fighter", A7: "heli", B1: "glider", B4: "light", B6: "light" };

export function shapeOf(a: Pick<Aircraft, "type" | "category">): Shape {
  const t = a.type?.toUpperCase();
  if (t) for (const [re, s] of RULES) if (re.test(t)) return s;
  if (a.category && BY_CATEGORY[a.category]) return BY_CATEGORY[a.category];
  return "narrow";
}

const cache = new Map<Shape, Path2D>();
export function path2d(s: Shape): Path2D {
  let p = cache.get(s);
  if (!p) { p = new Path2D(SHAPES[s]); cache.set(s, p); }
  return p;
}
