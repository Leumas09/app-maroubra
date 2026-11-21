// Construit apps/web/src/data/sky-catalog.json à partir des données de d3-celestial (BSD-3-Clause) :
// étoiles du catalogue Hipparcos jusqu'à la magnitude 5, lignes et noms des constellations, Voie lactée simplifiée.
const fs = require("fs");
const dir = process.argv[2], out = process.argv[3];
const J = (f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
const r1 = (x) => Math.round(x * 100) / 100;
const ra = (x) => r1(((x % 360) + 360) % 360);
const names = J("starnames.json");
const stars = J("stars.6.json").features
  .filter((f) => f.properties.mag <= 5.0)
  .map((f) => {
    const n = names[f.id] ?? {};
    const name = n.name || "";
    return [ra(f.geometry.coordinates[0]), r1(f.geometry.coordinates[1]), Math.round(f.properties.mag * 100) / 100, Math.round(parseFloat(f.properties.bv || "0.6") * 100) / 100, name, f.id];
  })
  .sort((a, b) => a[2] - b[2]);
const lines = J("constellations.lines.json").features.flatMap((f) => f.geometry.coordinates.map((l) => l.map(([x, y]) => [ra(x), r1(y)])));
const cons = J("constellations.json").features.map((f) => [ra(f.geometry.coordinates[0]), r1(f.geometry.coordinates[1]), f.properties.en || f.properties.name, Number(f.properties.rank)]);
const mwRaw = J("mw.json").features;
const simplify = (ring, step) => ring.filter((_, i) => i % step === 0).map(([x, y]) => [ra(x), Math.round(y * 10) / 10]);
const mw = ["ol1", "ol2"].map((id) => mwRaw.find((f) => f.id === id).geometry.coordinates.flatMap((poly) => poly.map((ring) => simplify(ring, 3))).filter((r) => r.length > 4));
fs.writeFileSync(out, JSON.stringify({ source: "d3-celestial 0.7.35 data (BSD-3-Clause, Olaf Frohn): Hipparcos stars to magnitude 5, constellation lines and names, Milky Way outline", stars, lines, cons, mw }));
console.log("stars", stars.length, "named", stars.filter((s) => s[4]).length, "lines", lines.length, "cons", cons.length, "mw rings", mw.map((m) => m.length), "bytes", fs.statSync(out).size);
