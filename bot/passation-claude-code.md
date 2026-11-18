# Bot Day Trader — passation vers Claude Code

## À lire en premier (instructions pour Claude Code)

Ce fichier contient tout le projet « Bot Day Trader » de Maximilien : le cahier des charges (v0.6) et le code. Il a été préparé le 18/11/2026 dans un projet claude.ai dont l'environnement ne peut pas joindre Binance. La suite se fait ici, dans une session Claude Code dont l'environnement autorise les domaines Binance.

**Façon de travailler avec Maximilien**
- Réponses en français.
- Il est étudiant ingénieur en génie chimique et a des bases en Python. Il veut comprendre : explications pas à pas, graphes clairs, avec l'équation de la droite de régression quand c'est pertinent.
- Il aime être challengé et qu'on lui pose des questions.
- Son objectif : le meilleur rendement monétaire, jugé sur données réelles (voir le protocole dans le cahier).

**Règles de sécurité**
- Données de marché publiques uniquement : aucune clé API, aucun ordre, aucun accès au compte.
- Les clés API ne passent jamais par le chat. La mise en direct se décidera plus tard avec lui (testnet d'abord).

**Démarrage**
1. Recréer les fichiers de la section « Code » dans un dossier `bot/`, avec exactement le contenu des blocs (le nom du fichier est indiqué au-dessus de chaque bloc).
2. Lancer `python banc_de_test.py 50` pour vérifier que tout tourne (numpy et matplotlib requis).
3. Tester l'accès réseau à `api.binance.com`, `data-api.binance.vision` et `data.binance.vision`. En cas d'erreur 403, s'arrêter et le dire à Maximilien.
4. Télécharger BTCUSDT puis ETHUSDT en bougies de 4 h depuis le début de l'historique (2017), via les archives mensuelles de `data.binance.vision` ou `donnees_binance.py` (intervalle `4h`). Contrôler les trous et les doublons.
5. Adapter le banc de test aux données réelles et appliquer la section « Protocole de choix sur données réelles » du cahier : liste des variantes fixée avant de regarder les résultats, découpage dans le temps entraînement / validation / test, période de test ouverte une seule fois.
6. Rendre compte à Maximilien : tableau des variantes (total final, pire repli, nombre de trades, mort ou non), graphes, verdict honnête face à acheter-garder. Mettre à jour le cahier des charges.

Les anciens fichiers de la v1 (`simulation.py`, `genetique.py`) restent dans le projet claude.ai ; ils ne sont pas nécessaires ici.

---

# Bot Day Trader — cahier des charges (v0.6)

## Choix actés
- Objectif prioritaire : le meilleur rendement monétaire (capital + coffre à l'arrivée). Le choix entre les variantes se fera sur données réelles. La mort sous 65 % de PV reste une contrainte dure.
- Marché : crypto (spot, long uniquement au départ), bougies de 4 h (15 min abandonné, voir « Leçons »)
- Positions gardées la nuit : oui
- Capital de départ : 100 € (fictif d'abord, réel ensuite)
- Le bot est lancé par Maximilien avec ses propres clés API (sans droit de retrait ni de transfert), testnet Binance d'abord
- Règle du jeu fixe : mort sous 65 % de PV
- Les clés API ne passent jamais par le chat ; variables d'environnement sur la machine de Maximilien
- Mise en direct : à rediscuter plus tard ; on se concentre d'abord sur la stratégie

## Accès aux données Binance (lecture seule)
- Claude lit lui-même les données de marché Binance : historique des bougies (backtests) et, plus tard, prix récents (suivi).
- Données publiques uniquement, sans clé API : lecture seule, aucun ordre, aucun accès au compte.
- Domaines à autoriser (un par ligne) :
  - `api.binance.com` (API principale, endpoint `/api/v3/klines`)
  - `data-api.binance.vision` (même API, réservée aux données de marché publiques)
  - `data.binance.vision` (archives CSV des bougies, idéal pour plusieurs années d'historique)
  - `data.binance.com` (demandé par Maximilien)
- Décision du 18/11/2026 : l'environnement du projet claude.ai ne peut pas être réglé (accès Binance refusé, erreur 403). Le travail sur données réelles continue dans une session Claude Code, dont l'environnement cloud autorise ces domaines (Network access = Custom + liste par défaut des gestionnaires de paquets).
- Passation : fichier « Bot Day Trader – passation Claude Code.md » (cahier des charges + code + instructions de démarrage), à joindre au premier message de la session Claude Code. Copie dans ce projet : claude/passation-claude-code.md.
- Point d'attention : `api.binance.com` peut refuser les requêtes venant de certains pays (« restricted location ») ; les domaines `.binance.vision` servent de repli.
- Plan B si l'accès bloque encore : Maximilien lance donnees_binance.py sur son PC et envoie le CSV.

## Système de survie (survie.py)
- PV = capital de trading / plus haut depuis la dernière mise au coffre
- Zones par défaut : vert ≥ 90 % (taille ×1) · orange 80–90 % (×0,5) · rouge 65–80 % (×0,25, signaux forts seulement) · mort < 65 % (tout fermé, arrêt)
- Régénération (`regen`) et coffre (+10 % → 50 % du gain au coffre, inaccessible au bot)

## Stratégie v2 (strategie.py) — suivi de tendance + ciblage de volatilité
1. Signal : vote de 4 moyennes mobiles (60, 120, 240, 480 bougies de 4 h ≈ 10 à 80 jours). Signal = part de moyennes dépassées par le prix (0 à 1). Long uniquement.
2. Taille : volatilité cible 30 % annuelle → taille = min(1, 0,30 / vol récente sur 60 bougies). Pas de levier.
3. Frais : on ne retouche la position que si l'écart à la cible dépasse 25 % du capital.
4. Survie : le multiplicateur de zone s'applique par-dessus.
5. Exécution : décision prise avec la bougie précédente (aucun regard dans le futur).
Pourquoi cette forme : très peu de paramètres (donc peu de sur-apprentissage), horizons multiples (robuste au choix d'un horizon), trades rares (les frais mangent le day trading rapide).

## Banc de test (banc_de_test.py, marches.py)
Deux marchés synthétiques de 3 ans, 300 marchés neufs chacun, frais 0,1 % : marche aléatoire (aucun avantage possible) et marché à régimes haussier/baissier/range symétriques.

| Médiane (€, départ 100) | Aléatoire | Régimes | Drawdown médian |
|---|---|---|---|
| Acheter-garder | 107 | 121 | 69 % |
| v1 croisement + survie | 92 | 99 | 20 % |
| v2 + survie | 96 | 112 | 19 % / 18 % |
| v2 sans survie | 100 | 126 | 32 % / 30 % |

- Aléatoire : la v2 ne fabrique pas de gain (≈ –4 % de frais), 0 mort ; c'est le résultat attendu.
- Régimes : la v2 passe de 99 (v1) à 112 et gagne dans 67 % des cas, avec un drawdown ~4× plus faible qu'acheter-garder.
- La survie a un coût : ~14 € de médiane en moins sur les régimes, en échange d'un drawdown de 30 % → 18 %. C'est le prix de l'assurance.
- Sensibilité (sensibilite.py, 100 marchés) : plateau, pas de pic ; horizons, volatilité cible et bande changent peu le résultat → pas de sur-réglage visible.
- Moteur vérifié : sans frais et tout investi = acheter-garder exactement ; jamais investi = 100 € ; un aller-retour coûte 0,2 %.

## Limites à ne pas oublier
- Ces marchés sont inventés : ils valident le code et le protocole, pas la rentabilité réelle. Le « gain » sur les régimes existe parce qu'on a mis des régimes persistants dans le simulateur.
- Réglages choisis au milieu du plateau de sensibilité (légère influence des marchés synthétiques).
- Pas de slippage ni de spread modélisés au-delà des 0,1 % de frais.
- Un historique BTC réel n'est qu'un seul chemin : un gagnant sur ce chemin peut être de la chance.

## Leçons
- Sur un marché sans motif, l'évolution génétique apprend le bruit (sur-apprentissage). Le gain réel vient de trader moins et de gérer le risque.
- Le day trading à 15 min est dominé par les frais et le bruit : horizon 4 h retenu.

## Protocole de choix sur données réelles (objectif : rendement)
- Variantes candidates, liste fixée AVANT de regarder les données : acheter-garder · v2 + survie (vol cible 30 %) · v2 survie allégée (mort à 65 % gardée, zones orange/rouge moins pénalisantes) · v2 vol cible plus haute (50 %, 70 %).
- Découpage dans le temps : entraînement → validation (on choisit la variante au meilleur total) → test final, ouvert une seule fois pour confirmer.
- Critère : capital + coffre à l'arrivée ; bot mort = éliminé. On affiche aussi le pire repli pour savoir ce que coûte le rendement.
- Robustesse : vérifier que la variante choisie reste bonne sur ETH et sur des points de départ décalés, pas seulement sur BTC.

## Prochaines étapes
- Reprendre dans Claude Code : tester l'accès Binance, télécharger BTCUSDT et ETHUSDT en bougies 4 h depuis 2017
- Appliquer le protocole de choix ci-dessus
- Verdict honnête : si aucune variante ne bat acheter-garder hors échantillon, on ne passe pas en direct
- Ensuite seulement : algorithme génétique sur 3-4 réglages max, avec validation en marche avant
- Règle du coffre définitive ; mise en direct (testnet puis réel)

---

# Code

## `survie.py`

```python
"""
Module de survie du bot : points de vie (PV) + coffre-fort.

Principe :
- Les PV = capital de trading / plus haut atteint depuis la dernière mise au coffre.
- Moins de PV  ->  plus prudent (taille de position réduite).
- Sous le seuil de mort, le bot ferme tout et s'arrête.
- Chaque fois que le capital gagne +X % depuis la base, une part du gain part
  au coffre. Le coffre est hors de portée du bot : il ne peut jamais y puiser.
"""

from dataclasses import dataclass, field


@dataclass
class ReglagesSurvie:
    capital_initial: float = 100.0   # PV de départ (€)
    seuil_mort: float = 0.65         # meurt sous 65 % de son plus haut (-35 %)
    seuil_orange: float = 0.90       # sous 90 % : blessé
    seuil_rouge: float = 0.80        # sous 80 % : critique
    palier_coffre: float = 0.10      # +10 % de gain déclenche une mise au coffre
    part_coffre: float = 0.50        # 50 % du gain part au coffre
    mult_orange: float = 0.5         # taille de position en zone orange
    mult_rouge: float = 0.25         # taille de position en zone rouge
    regen: float = 0.0               # régénération : part de l'écart au plus haut
                                     # "oubliée" à chaque bougie (0 = aucune)


@dataclass
class EtatBot:
    capital: float
    plus_haut: float
    base_coffre: float
    coffre: float = 0.0
    vivant: bool = True
    historique: list = field(default_factory=list)


class GestionnaireSurvie:
    def __init__(self, reglages: ReglagesSurvie | None = None):
        self.r = reglages or ReglagesSurvie()
        c = self.r.capital_initial
        self.etat = EtatBot(capital=c, plus_haut=c, base_coffre=c)

    # ---------- lecture de l'état ----------
    @property
    def pv(self) -> float:
        """Points de vie entre 0 et 1."""
        return self.etat.capital / self.etat.plus_haut

    @property
    def zone(self) -> str:
        if not self.etat.vivant or self.pv < self.r.seuil_mort:
            return "mort"
        if self.pv < self.r.seuil_rouge:
            return "rouge"
        if self.pv < self.r.seuil_orange:
            return "orange"
        return "vert"

    @property
    def multiplicateur(self) -> float:
        return {"vert": 1.0, "orange": self.r.mult_orange,
                "rouge": self.r.mult_rouge, "mort": 0.0}[self.zone]

    def peut_trader(self, force_signal: float = 1.0) -> bool:
        """En zone rouge, seuls les signaux forts (>= 0.8) sont acceptés."""
        if self.zone == "mort":
            return False
        if self.zone == "rouge":
            return force_signal >= 0.8
        return True

    # ---------- mise à jour après chaque trade / bougie ----------
    def mettre_a_jour(self, nouveau_capital: float, t=None, historiser: bool = True) -> None:
        if not self.etat.vivant:
            return
        e = self.etat
        e.capital = nouveau_capital
        # régénération : le plus haut de référence redescend doucement vers
        # le capital actuel, donc les PV remontent avec le temps
        e.plus_haut -= self.r.regen * (e.plus_haut - e.capital)
        e.plus_haut = max(e.plus_haut, e.capital)

        # mort ?
        if self.pv < self.r.seuil_mort:
            e.vivant = False

        # mise au coffre ?
        elif e.capital >= e.base_coffre * (1 + self.r.palier_coffre):
            gain = e.capital - e.base_coffre
            depot = gain * self.r.part_coffre
            e.coffre += depot
            e.capital -= depot
            # le bot repart "soigné" à 100 % PV sur son nouveau niveau
            e.base_coffre = e.capital
            e.plus_haut = e.capital

        if historiser:
            e.historique.append(
                {"t": t, "capital": e.capital, "coffre": e.coffre,
                 "pv": self.pv, "zone": self.zone}
            )
```

## `strategie.py`

```python
"""
Stratégie v2 : suivi de tendance multi-horizons + ciblage de volatilité.

Idées (peu de paramètres, donc peu de risque de sur-apprentissage) :
  1. SIGNAL  : vote de plusieurs moyennes mobiles (60, 120, 240, 480 bougies de 4 h,
               soit ~10 à 80 jours). Signal = part de moyennes que le prix dépasse
               (0, 0.25, 0.5, 0.75, 1). Long uniquement.
  2. TAILLE  : on vise une volatilité de portefeuille constante
               (taille = min(1, vol_cible / vol_récente)). Quand le marché s'agite,
               on réduit ; quand il est calme, on prend toute la place.
  3. FRAIS   : on ne retouche la position que si l'écart à la cible dépasse
               une bande (25 % du capital) : moins de trades, moins de frais.
  4. SURVIE  : le multiplicateur de zone (vert/orange/rouge) vient s'appliquer
               par-dessus, comme dans survie.py.
"""

import numpy as np

from survie import GestionnaireSurvie, ReglagesSurvie

FRAIS = 0.001                 # 0,1 % par ordre
BOUGIES_PAR_AN = 6 * 365      # bougies de 4 h
WARMUP = 480                  # historique nécessaire avant de trader


# --------------------------------------------------------------------- outils
def moyenne_mobile(x, n):
    out = np.full(len(x), np.nan)
    c = np.cumsum(np.insert(x, 0, 0.0))
    out[n - 1:] = (c[n:] - c[:-n]) / n
    return out


def vol_realisee(prix, fenetre=60):
    """Volatilité annualisée glissante (écart-type des rendements log)."""
    r = np.diff(np.log(prix), prepend=np.log(prix[0]))
    c1 = np.cumsum(np.insert(r, 0, 0.0))
    c2 = np.cumsum(np.insert(r ** 2, 0, 0.0))
    out = np.full(len(r), np.nan)
    n = fenetre
    m = (c1[n:] - c1[:-n]) / n
    v = (c2[n:] - c2[:-n]) / n - m ** 2
    out[n - 1:] = np.sqrt(np.maximum(v, 0)) * np.sqrt(BOUGIES_PAR_AN)
    return out


# -------------------------------------------------------------------- signaux
def signal_vote_mm(prix, horizons=(60, 120, 240, 480)):
    votes = np.zeros(len(prix))
    valide = np.ones(len(prix), bool)
    for L in horizons:
        mm = moyenne_mobile(prix, L)
        valide &= ~np.isnan(mm)
        votes += prix > mm
    s = votes / len(horizons)
    s[~valide] = np.nan
    return s


def signal_croisement(prix, courte=20, longue=100):
    """Référence 'v1' : tout ou rien sur un croisement de moyennes mobiles."""
    a, b = moyenne_mobile(prix, courte), moyenne_mobile(prix, longue)
    s = (a > b).astype(float)
    s[np.isnan(b)] = np.nan
    return s


def echelle_vol(prix, vol_cible=0.30, fenetre=60):
    v = vol_realisee(prix, fenetre)
    return np.minimum(1.0, vol_cible / np.maximum(v, 1e-9))


# --------------------------------------------------------------------- moteur
def reglages_sans_survie():
    return ReglagesSurvie(seuil_mort=0.0, seuil_orange=0.0, seuil_rouge=0.0,
                          palier_coffre=1e9)


def executer(prix, signal, echelle, reglages=None, bande=0.25, t0=WARMUP, frais=FRAIS):
    """Simule le bot de la bougie t0 à la fin. Retourne un dict de résultats."""
    r = reglages or ReglagesSurvie()
    bot = GestionnaireSurvie(r)
    esp, qte = r.capital_initial, 0.0
    n = len(prix)
    equity = np.empty(n - t0)
    trades = 0

    for t in range(t0, n):
        p = prix[t]
        i = t - t0
        valeur = esp + qte * p

        # --- survie
        avant = bot.etat.coffre
        bot.mettre_a_jour(valeur, t, historiser=False)
        retrait = bot.etat.coffre - avant
        if retrait > 0:                      # le coffre sort du jeu
            if esp < retrait:
                a_vendre = (retrait - esp) / (p * (1 - frais))
                qte -= a_vendre
                esp += a_vendre * p * (1 - frais)
            esp -= retrait

        if not bot.etat.vivant:              # mort : tout fermé, arrêt
            esp += qte * p * (1 - frais)
            qte = 0.0
            equity[i:] = esp + bot.etat.coffre
            break

        valeur = esp + qte * p
        equity[i] = valeur + bot.etat.coffre

        # décision prise avec la bougie PRÉCÉDENTE (pas de regard dans le futur)
        s = signal[t - 1]
        if np.isnan(s):
            continue
        cible = s * echelle[t - 1] * bot.multiplicateur if bot.peut_trader(s) else 0.0
        frac = qte * p / valeur if valeur > 0 else 0.0

        if (cible == 0.0 and frac > 1e-6) or abs(cible - frac) > bande:
            delta = (cible - frac) * valeur          # > 0 : acheter, < 0 : vendre
            if delta > 0:
                delta = min(delta, esp)
                qte += delta * (1 - frais) / p
                esp -= delta
            else:
                vend = min(-delta, qte * p)
                qte -= vend / p
                esp += vend * (1 - frais)
            if cible == 0.0:
                esp += qte * p * (1 - frais)
                qte = 0.0
            trades += 1

    pic = np.maximum.accumulate(equity)
    return {
        "final": float(equity[-1]),
        "max_dd": float(np.max(1 - equity / pic)),
        "mort": not bot.etat.vivant,
        "trades": trades,
        "coffre": bot.etat.coffre,
        "equity": equity,
    }


def acheter_garder(prix, t0=WARMUP, frais=FRAIS, capital=100.0):
    eq = capital * (1 - frais) * prix[t0:] / prix[t0]
    pic = np.maximum.accumulate(eq)
    return {"final": float(eq[-1] * (1 - frais)), "max_dd": float(np.max(1 - eq / pic)),
            "mort": False, "trades": 1, "coffre": 0.0, "equity": eq}
```

## `marches.py`

```python
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
```

## `banc_de_test.py`

```python
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
```

## `sensibilite.py`

```python
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
```

## `donnees_binance.py`

```python
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
```
