"""
Banc de test : compare les stratégies sur de nombreux marchés jamais vus.
Usage : python banc_de_test.py            (marchés synthétiques)
"""

import sys
import numpy as np

from marches import marche_aleatoire, marche_regimes, BOUGIES_PAR_AN
from strategie import (executer, acheter_garder, signal_vote_mm, signal_croisement,
                       echelle_vol, reglages_sans_survie, WARMUP)
from survie import ReglagesSurvie

N_MARCHES = int(sys.argv[1]) if len(sys.argv) > 1 else 200
N_BOUGIES = 3 * BOUGIES_PAR_AN + WARMUP          # 3 ans de trading


def strategies(prix):
    un = np.ones(len(prix))
    s_v2, e_v2 = signal_vote_mm(prix), echelle_vol(prix)
    s_v1 = signal_croisement(prix)
    return {
        "Acheter-garder":          acheter_garder(prix),
        "v1 croisement + survie":  executer(prix, s_v1, un, ReglagesSurvie()),
        "v2 tendance+vol + survie": executer(prix, s_v2, e_v2, ReglagesSurvie()),
        "v2 sans survie":          executer(prix, s_v2, e_v2, reglages_sans_survie()),
    }


def resume(nom_marche, generateur, graine):
    rng = np.random.default_rng(graine)
    res = {}
    for _ in range(N_MARCHES):
        prix = generateur(rng, N_BOUGIES)
        for k, v in strategies(prix).items():
            res.setdefault(k, []).append(v)
    print(f"\n=== {nom_marche} ({N_MARCHES} marchés de 3 ans, départ 100 €, frais 0,1 %) ===")
    print(f"{'':26s} {'médian':>7s} {'p10':>6s} {'p90':>6s} {'>100€':>6s} {'morts':>6s} "
          f"{'DD méd.':>8s} {'trades':>7s}")
    for k, lst in res.items():
        f = np.array([x["final"] + (0 if k.startswith("Acheter") else 0) for x in lst])
        print(f"{k:26s} {np.median(f):7.1f} {np.percentile(f,10):6.1f} {np.percentile(f,90):6.1f} "
              f"{100*np.mean(f>100):5.0f}% {100*np.mean([x['mort'] for x in lst]):5.0f}% "
              f"{100*np.median([x['max_dd'] for x in lst]):7.0f}% "
              f"{np.median([x['trades'] for x in lst]):7.0f}")
    return res


if __name__ == "__main__":
    resume("MARCHÉ ALÉATOIRE (aucun avantage possible)", marche_aleatoire, 101)
    resume("MARCHÉ À RÉGIMES (tendances persistantes)", marche_regimes, 102)
