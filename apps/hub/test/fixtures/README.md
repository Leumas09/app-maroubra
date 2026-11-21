# Jeux de test

| Fichier | Origine | Licence |
|---|---|---|
| `rfs-majorincidents-2020-10-10.json` | Flux réel `majorIncidents.json` du NSW RFS du 10/10/2020, tel que conservé dans les tests du paquet npm `@beyondtracks/nsw-rfs-majorincidents-geojson` | © State of New South Wales (NSW Rural Fire Service), CC BY 4.0 |
| `randwick-lifeguards-2026-11-09.xml` | Flux RSS des rapports de sauveteurs de Randwick City Council : l'item Maroubra est la capture réelle du 09/11/2026 conservée dans les tests du projet public `lukewjudd/beach-bot` ; l'item Clovelly de la veille est construit sur le même modèle | © Randwick City Council |
| `bom-warnings-nsw-2026-11-21.xml` | Flux RSS réel des avertissements NSW du Bureau of Meteorology (`IDZ00054`) du 21/11/2026 | © Commonwealth of Australia, Bureau of Meteorology |
| `adsbfi-point-2026-11-20.json` | Réponse réelle de `opendata.adsb.fi/api/v2/lat/-33.9496/lon/151.2577/dist/25` le 20/11/2026, réduite aux 6 premiers avions | Données ouvertes adsb.fi, usage non commercial |

Les autres données de test sont construites à la main dans les tests eux-mêmes, au format documenté par chaque source
(code source d'adsb.lol pour les avions, API Open-Meteo, produits NOAA SWPC), et signalées comme telles.
