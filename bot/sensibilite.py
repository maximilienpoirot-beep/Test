"""Sensibilité de la v2 à ses réglages (sur marchés synthétiques) : plateau ou pic ?"""
import sys, itertools
import numpy as np
from marches import marche_aleatoire, marche_regimes, BOUGIES_PAR_AN
from strategie import executer, signal_vote_mm, echelle_vol, WARMUP
from survie import ReglagesSurvie

N = int(sys.argv[1]) if len(sys.argv) > 1 else 100
NB = 3 * BOUGIES_PAR_AN + WARMUP
HORIZONS = {"30-240": (30, 60, 120, 240), "60-480": (60, 120, 240, 480), "120-480": (120, 240, 360, 480)}
BANDES = [0.10, 0.25, 0.40]
VOLS = [0.30, 0.50]

for nom, gen, graine in [("ALÉATOIRE", marche_aleatoire, 11), ("RÉGIMES", marche_regimes, 12)]:
    rng = np.random.default_rng(graine)
    marches = [gen(rng, NB) for _ in range(N)]
    print(f"\n== {nom} ({N} marchés) : médian € / % morts / trades médians ==")
    print(f"{'horizons':9s} {'vol':>4s} " + " ".join(f"bande {b:.2f}      " for b in BANDES))
    for hn, hz in HORIZONS.items():
        for vc in VOLS:
            cells = []
            for b in BANDES:
                fin, mort, tr = [], [], []
                for p in marches:
                    r = executer(p, signal_vote_mm(p, hz), echelle_vol(p, vc), ReglagesSurvie(), bande=b)
                    fin.append(r["final"]); mort.append(r["mort"]); tr.append(r["trades"])
                cells.append(f"{np.median(fin):6.1f}/{100*np.mean(mort):2.0f}%/{np.median(tr):4.0f}")
            print(f"{hn:9s} {vc:4.2f} " + "  ".join(cells))
