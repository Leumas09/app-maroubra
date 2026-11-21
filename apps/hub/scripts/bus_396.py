"""Horaires du bus 396 à l'arrêt « Maroubra Rd after Hereward St » (TfNSW 2035144), vers Maroubra Junction.

Source : GTFS des bus de Sydney publié par Transport for NSW Open Data (CC BY 4.0),
https://api.transport.nsw.gov.au/v1/gtfs/schedule/buses (clé d'API gratuite, jamais dans le dépôt).
On garde, pour chaque jour de semaine couvert par le calendrier, les départs entre 7 h 15 et 7 h 45
et entre 8 h 15 et 8 h 45, exceptions (jours fériés, vacances) comprises.

Usage : python3 apps/hub/scripts/bus_396.py <buses.zip> <sortie.json>
"""
import csv
import io
import json
import sys
import zipfile
from datetime import date, timedelta

STOP, ROUTE, DIRECTION = "2035144", "2509_396", "1"
WINDOWS = [("07:15", "07:45"), ("08:15", "08:45")]

z = zipfile.ZipFile(sys.argv[1])
rd = lambda n: csv.DictReader(io.TextIOWrapper(z.open(n), encoding="utf-8-sig"))

trips = {t["trip_id"]: t["service_id"] for t in rd("trips.txt") if t["route_id"] == ROUTE and t["direction_id"] == DIRECTION}
times = {}
for st in rd("stop_times.txt"):
    if st["stop_id"] == STOP and st["trip_id"] in trips:
        times.setdefault(trips[st["trip_id"]], []).append(st["departure_time"][:5])

cal = {c["service_id"]: c for c in rd("calendar.txt") if c["service_id"] in times}
extra = {}
for d in rd("calendar_dates.txt"):
    if d["service_id"] in times:
        extra.setdefault(d["date"], {})[d["service_id"]] = d["exception_type"]  # 1 ajout, 2 retrait

days = {}
first = min(c["start_date"] for c in cal.values())
last = max(c["end_date"] for c in cal.values())
d = date(int(first[:4]), int(first[4:6]), int(first[6:]))
end = date(int(last[:4]), int(last[4:6]), int(last[6:]))
names = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
while d <= end:
    if d.weekday() < 5:
        key = d.strftime("%Y%m%d")
        active = {s for s, c in cal.items() if c["start_date"] <= key <= c["end_date"] and c[names[d.weekday()]] == "1"}
        for s, kind in extra.get(key, {}).items():
            (active.add if kind == "1" else active.discard)(s)
        deps = sorted({t for s in active for t in times.get(s, []) if any(a <= t <= b for a, b in WINDOWS)})
        days[d.isoformat()] = deps
    d += timedelta(days=1)

feed = [n for n in z.namelist()]
out = {
    "route": "396", "stop": {"id": STOP, "name": "Maroubra Rd after Hereward St"}, "towards": "Maroubra Junction and City Circular Quay",
    "windows": WINDOWS, "source": "Transport for NSW Open Data, Sydney buses GTFS (CC BY 4.0)",
    "published": sys.argv[3] if len(sys.argv) > 3 else None, "from": min(days), "to": max(days), "days": days,
}
json.dump(out, open(sys.argv[2], "w"), separators=(",", ":"))
print(len(days), "weekdays from", out["from"], "to", out["to"])
for k in list(days)[:6]:
    print(k, days[k])
