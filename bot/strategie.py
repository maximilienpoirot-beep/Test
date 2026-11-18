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


# ------------------------------------------------------- achat à la baisse
def ecart_type_mobile(x, n):
    out = np.full(len(x), np.nan)
    c1 = np.cumsum(np.insert(x, 0, 0.0))
    c2 = np.cumsum(np.insert(x ** 2, 0, 0.0))
    m = (c1[n:] - c1[:-n]) / n
    out[n - 1:] = np.sqrt(np.maximum((c2[n:] - c2[:-n]) / n - m ** 2, 0))
    return out


def signal_repli(prix, n=60, k=2.0):
    """Achat à la baisse (bandes de Bollinger) : on entre quand le prix tombe sous
    MM(n) - k écarts-types, on sort quand il repasse au-dessus de MM(n). 0 ou 1."""
    mm, sd = moyenne_mobile(prix, n), ecart_type_mobile(prix, n)
    s = np.full(len(prix), np.nan)
    dedans = 0.0
    for t in range(n - 1, len(prix)):
        if dedans == 0.0 and prix[t] < mm[t] - k * sd[t]:
            dedans = 1.0
        elif dedans == 1.0 and prix[t] > mm[t]:
            dedans = 0.0
        s[t] = dedans
    return s


def signal_tendance_repli(prix, horizons=(60, 120, 240, 480)):
    """v2 + achat des creux : si la tendance longue est haussière (prix > MM480)
    et qu'un creux de Bollinger est en cours, on passe à pleine taille."""
    s = signal_vote_mm(prix, horizons)
    creux = signal_repli(prix) == 1.0
    haussier = prix > moyenne_mobile(prix, max(horizons))
    out = s.copy()
    out[creux & haussier & ~np.isnan(s)] = 1.0
    return out
