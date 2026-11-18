"""
Télécharge l'historique de bougies Binance et l'enregistre en CSV.

Données PUBLIQUES de marché : aucune clé API nécessaire (et il ne faut pas en mettre).
Usage :
    python donnees_binance.py BTCUSDT 1h 2021-01-01 2026-11-01
Produit : BTCUSDT_1h.csv  (colonnes : t_ms, ouverture, haut, bas, cloture, volume)
"""

import csv
import json
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import urlopen

URL = "https://data-api.binance.vision/api/v3/klines"   # endpoint public, lecture seule
PAS_MS = {"15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "4h": 14_400_000}


def en_ms(date_iso):
    d = datetime.fromisoformat(date_iso).replace(tzinfo=timezone.utc)
    return int(d.timestamp() * 1000)


def telecharger(symbole, intervalle, debut, fin):
    t, fin_ms, lignes = en_ms(debut), en_ms(fin), []
    while t < fin_ms:
        q = urlencode(dict(symbol=symbole, interval=intervalle,
                           startTime=t, endTime=fin_ms, limit=1000))
        with urlopen(f"{URL}?{q}", timeout=30) as r:
            lot = json.load(r)
        if not lot:
            break
        lignes += [(b[0], b[1], b[2], b[3], b[4], b[5]) for b in lot]
        t = lot[-1][0] + PAS_MS[intervalle]
        print(f"\r{len(lignes)} bougies...", end="", flush=True)
        time.sleep(0.2)                                   # reste poli avec l'API
    print()
    return lignes


def verifier_trous(lignes, intervalle):
    pas = PAS_MS[intervalle]
    trous = [(a[0], b[0]) for a, b in zip(lignes, lignes[1:]) if b[0] - a[0] != pas]
    print(f"Trous détectés : {len(trous)}")
    return trous


def main():
    symbole, intervalle, debut, fin = sys.argv[1:5]
    lignes = telecharger(symbole, intervalle, debut, fin)
    verifier_trous(lignes, intervalle)
    nom = f"{symbole}_{intervalle}.csv"
    with open(nom, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["t_ms", "ouverture", "haut", "bas", "cloture", "volume"])
        w.writerows(lignes)
    print(f"{len(lignes)} bougies enregistrées dans {nom}")


if __name__ == "__main__":
    main()
