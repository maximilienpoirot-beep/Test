"""
Marchés synthétiques (bougies de 4 h) pour tester le CODE et le protocole.

ATTENTION : ces marchés sont inventés. Ils ne disent rien sur la rentabilité réelle
d'une stratégie ; ils servent à vérifier (1) qu'elle ne fabrique pas de gains dans
un marché sans motif, (2) qu'elle exploite une tendance quand il y en a une,
(3) que la gestion du risque fait son travail.
"""

import numpy as np

BOUGIES_PAR_JOUR = 6
BOUGIES_PAR_AN = 6 * 365


def marche_aleatoire(rng, n, vol=0.60, p0=30_000.0):
    """Marche aléatoire pure : AUCUN avantage possible. Rendements à queues épaisses."""
    sigma = vol / np.sqrt(BOUGIES_PAR_AN)
    chocs = rng.standard_t(4, n) / np.sqrt(2.0)          # t(4) de variance 1
    return p0 * np.exp(np.cumsum(sigma * chocs))


def marche_regimes(rng, n, p0=30_000.0):
    """
    Régimes persistants : haussier / baissier / range, volatilité propre à chaque régime.
    Symétrique (dérive moyenne ~ 0) : un « acheter-garder » n'a pas de cadeau,
    seule la persistance des régimes peut être exploitée.
    """
    mu = np.array([+1.2, -1.2, 0.0])         # dérive annuelle (log)
    vol = np.array([0.50, 0.75, 0.40])       # volatilité annuelle
    duree_jours = np.array([80, 50, 70])
    sortie = 1.0 / (duree_jours * BOUGIES_PAR_JOUR)
    suivant = np.array([[0.0, 0.4, 0.6],
                        [0.4, 0.0, 0.6],
                        [0.5, 0.5, 0.0]])
    reg = np.empty(n, int)
    r = rng.integers(3)
    for t in range(n):
        reg[t] = r
        if rng.random() < sortie[r]:
            r = rng.choice(3, p=suivant[r])
    sigma = vol[reg] / np.sqrt(BOUGIES_PAR_AN)
    chocs = rng.standard_t(4, n) / np.sqrt(2.0)
    rend = mu[reg] / BOUGIES_PAR_AN - 0.5 * sigma ** 2 + sigma * chocs
    return p0 * np.exp(np.cumsum(rend))
