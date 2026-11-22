"""Horaires des bus 396 et 396X à l'arrêt « Maroubra Rd after Hereward St » (TfNSW 2035144), vers Maroubra Junction et la ville.

Source : GTFS des bus de Sydney publié par Transport for NSW Open Data (CC BY 4.0),
https://api.transport.nsw.gov.au/v1/gtfs/schedule/buses (clé d'API gratuite, jamais dans le dépôt).
On garde tous les départs de la journée, pour chaque jour de semaine couvert par le calendrier,
exceptions (jours fériés, vacances) comprises : les plages horaires affichées se règlent dans Settings,
l'app filtre elle-même. Les départs après minuit (heures GTFS de 24:00 et plus) sont rendus au jour civil suivant.
Les jours qui ont le même horaire partagent un seul tableau, pour garder le fichier léger.

Usage : python3 apps/hub/scripts/bus.py <buses.zip> <sortie.json> [date de publication AAAA-MM-JJ]
"""
import csv
import io
import json
import sys
import zipfile
from datetime import date, timedelta

STOP, DIRECTION = "2035144", "1"
ROUTES = {"2509_396": "396", "2509_396X": "396X"}

z = zipfile.ZipFile(sys.argv[1])
rd = lambda n: csv.DictReader(io.TextIOWrapper(z.open(n), encoding="utf-8-sig"))

trips = {t["trip_id"]: (t["service_id"], ROUTES[t["route_id"]]) for t in rd("trips.txt") if t["route_id"] in ROUTES and t["direction_id"] == DIRECTION}
times = {}  # service_id -> [(heure GTFS HH:MM, ligne)]
for st in rd("stop_times.txt"):
    if st["stop_id"] == STOP and st["trip_id"] in trips:
        s, route = trips[st["trip_id"]]
        times.setdefault(s, []).append((st["departure_time"][:5], route))

cal = {c["service_id"]: c for c in rd("calendar.txt") if c["service_id"] in times}
extra = {}
for d in rd("calendar_dates.txt"):
    if d["service_id"] in times:
        extra.setdefault(d["date"], {})[d["service_id"]] = d["exception_type"]  # 1 ajout, 2 retrait

ymd = lambda s: date(int(s[:4]), int(s[4:6]), int(s[6:]))
first = min(ymd(c["start_date"]) for c in cal.values())
end = max(ymd(c["end_date"]) for c in cal.values())
names = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def services(d):
    key = d.strftime("%Y%m%d")
    active = {s for s, c in cal.items() if c["start_date"] <= key <= c["end_date"] and c[names[d.weekday()]] == "1"}
    for s, kind in extra.get(key, {}).items():
        (active.add if kind == "1" else active.discard)(s)
    return active


def departures(d):
    """Départs du jour civil d : ceux de son service avant minuit, plus ceux d'après minuit du service de la veille."""
    deps = set()
    for s in services(d):
        deps |= {(t, r) for t, r in times[s] if t < "24:00"}
    for s in services(d - timedelta(days=1)):
        deps |= {(f"{int(t[:2]) - 24:02d}{t[2:]}", r) for t, r in times[s] if t >= "24:00"}
    return deps


tables, index, days = [], {}, {}
d = first
while d <= end:
    if d.weekday() < 5:
        deps = departures(d)
        table = {r: sorted(t for t, rr in deps if rr == r) for r in ROUTES.values()}
        k = json.dumps(table, sort_keys=True)
        if k not in index:
            index[k] = len(tables)
            tables.append(table)
        days[d.isoformat()] = index[k]
    d += timedelta(days=1)

out = {
    "routes": list(ROUTES.values()), "stop": {"id": STOP, "name": "Maroubra Rd after Hereward St"},
    "towards": "Maroubra Junction and the City", "source": "Transport for NSW Open Data, Sydney buses GTFS (CC BY 4.0)",
    "published": sys.argv[3] if len(sys.argv) > 3 else None, "from": min(days), "to": max(days),
    "timetables": tables, "days": days,
}
json.dump(out, open(sys.argv[2], "w"), separators=(",", ":"))
print(len(days), "weekdays from", out["from"], "to", out["to"], "with", len(tables), "distinct timetables")
for k in list(days)[:3]:
    t = tables[days[k]]
    print(k, {r: [x for x in v if "07:00" <= x <= "09:30"] for r, v in t.items()})
