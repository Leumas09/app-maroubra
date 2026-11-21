"""Juge des positions d'étoiles de la carte du ciel : Skyfield + JPL DE421, observateur à Maroubra.
Étoiles du catalogue embarqué (apps/web/src/data/sky-catalog.json, J2000, sans mouvement propre),
position apparente (aberration, déviation de la lumière, précession et nutation), sans réfraction.

Sortie : packages/sky/test/fixtures/stars_skyfield.json
"""
import json
from pathlib import Path

from skyfield.api import Star, load, wgs84
from skyfield_data import get_skyfield_data_path

ROOT = Path(__file__).resolve().parents[1]
LAT, LON = -33.9496, 151.2577
cat = json.loads((ROOT / "apps/web/src/data/sky-catalog.json").read_text())
stars = [s for s in cat["stars"] if s[4]][:20]  # 20 étoiles nommées les plus brillantes

ts = load.timescale(builtin=True)
eph = load(str(Path(get_skyfield_data_path()) / "de421.bsp"))
obs = eph["earth"] + wgs84.latlon(LAT, LON)
times = ["2026-11-21T11:00:00Z", "2027-06-15T12:30:00Z", "2030-01-01T15:00:00Z"]

out = {"generator": "skyfield 1.55 + DE421", "site": {"lat": LAT, "lon": LON}, "cases": []}
for iso in times:
    y, mo, d = int(iso[0:4]), int(iso[5:7]), int(iso[8:10])
    h, mi = int(iso[11:13]), int(iso[14:16])
    t = ts.utc(y, mo, d, h, mi)
    for ra, dec, mag, bv, name, hip in stars:
        alt, az, _ = obs.at(t).observe(Star(ra_hours=ra / 15, dec_degrees=dec)).apparent().altaz()
        out["cases"].append({"t": iso, "name": name, "ra": ra, "dec": dec, "alt": alt.degrees, "az": az.degrees})
(ROOT / "packages/sky/test/fixtures/stars_skyfield.json").write_text(json.dumps(out, indent=1))
print(len(out["cases"]), "cases")
