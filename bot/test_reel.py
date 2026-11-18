"""
Test sur données réelles Binance, selon protocole_reel.md (figé avant les résultats).

Usage :
    python test_reel.py selection     # entraînement + validation, BTC et ETH
    python test_reel.py robustesse    # départs décalés (2017-2023 uniquement)
    python test_reel.py test          # 2024-2026 : UNE seule fois (verrou)
"""

import csv
import os
import sys
from datetime import datetime, timezone

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

from strategie import (executer, acheter_garder, signal_vote_mm, echelle_vol,
                       signal_repli, signal_tendance_repli)
from survie import ReglagesSurvie
from strategie import reglages_sans_survie

ICI = os.path.dirname(os.path.abspath(__file__))
SORTIE = os.path.join(ICI, "resultats")
VERROU = os.path.join(SORTIE, ".test_ouvert")
PAS_MS = 14_400_000

PERIODES = {
    "entrainement": ("2017-08-17", "2021-01-01"),
    "validation":   ("2021-01-01", "2024-01-01"),
    "test":         ("2024-01-01", "2026-11-19"),
}
WARMUP = 480

# ------------------------------------------------------------------ variantes
VARIANTES = {      # code: (nom, vol cible, réglages survie) ; None = acheter-garder
    "A": ("Acheter-garder", None, None),
    "B": ("v2 + survie (vol 30 %)", 0.30, ReglagesSurvie),
    "C": ("v2 survie allégée (vol 30 %)", 0.30, lambda: ReglagesSurvie(mult_orange=0.75, mult_rouge=0.5)),
    "D": ("v2 + survie (vol 50 %)", 0.50, ReglagesSurvie),
    "E": ("v2 + survie (vol 70 %)", 0.70, ReglagesSurvie),
    "R": ("(réf.) v2 sans survie (vol 30 %)", 0.30, reglages_sans_survie),
    # ajoutées le 18/11/2026 après le test BTC/ETH (achat à la baisse), réglages de C
    "F": ("achat à la baisse pur", 0.30, lambda: ReglagesSurvie(mult_orange=0.75, mult_rouge=0.5)),
    "G": ("tendance + achat des creux", 0.30, lambda: ReglagesSurvie(mult_orange=0.75, mult_rouge=0.5)),
}
SIGNAUX = {"F": signal_repli, "G": signal_tendance_repli}
BOTS = ["B", "C", "D", "E"]


# ------------------------------------------------------------------ données
def charger(symbole):
    """Charge le CSV, remet sur une grille régulière de 4 h et comble les trous
    (maintenances Binance) avec le dernier prix connu."""
    with open(os.path.join(ICI, "donnees", f"{symbole}_4h.csv")) as f:
        lignes = list(csv.DictReader(f))
    t = np.array([int(r["t_ms"]) for r in lignes])
    c = np.array([float(r["cloture"]) for r in lignes])
    grille = np.arange(t[0], t[-1] + 1, PAS_MS)
    idx = np.searchsorted(t, grille, side="right") - 1      # dernier prix connu
    dates = np.array([datetime.fromtimestamp(x / 1000, timezone.utc) for x in grille])
    return dates, c[idx]


def indice(dates, jour):
    d = datetime.fromisoformat(jour).replace(tzinfo=timezone.utc)
    return int(np.searchsorted(dates, d))


# ------------------------------------------------------------------ simulation
def lancer(code, prix, t0, t1, cache):
    """Fait tourner une variante de la bougie t0 à t1 (exclue), départ 100 €."""
    nom, vol, regl = VARIANTES[code]
    p = prix[:t1]
    if vol is None:
        return acheter_garder(p, t0=t0)
    cle = ("s", code if code in SIGNAUX else "v2")
    if cle not in cache:
        cache[cle] = SIGNAUX.get(code, signal_vote_mm)(prix)
    if ("e", vol) not in cache:
        cache[("e", vol)] = echelle_vol(prix, vol)
    return executer(p, cache[cle][:t1], cache[("e", vol)][:t1], regl(), t0=t0)


def tableau(titre, res):
    print(f"\n=== {titre} ===")
    print(f"{'':36s} {'total €':>8s} {'pire repli':>10s} {'trades':>7s} {'mort':>5s} {'coffre €':>9s}")
    for code, r in res.items():
        mort = "OUI" if r["mort"] else "non"
        if code == "A" and r["max_dd"] > 0.35:
            mort = "(×)"            # un bot soumis à la règle des 65 % serait mort
        print(f"{code} {VARIANTES[code][0]:34s} {r['final']:8.1f} {100*r['max_dd']:9.0f}% "
              f"{r['trades']:7d} {mort:>5s} {r['coffre']:9.1f}")


def regression_log(dates, eq):
    """ln(capital) = a + b * années  ->  rendement annuel moyen = e^b - 1."""
    x = np.array([(d - dates[0]).total_seconds() / (365 * 86400) for d in dates])
    b, a = np.polyfit(x, np.log(eq), 1)
    return a, b, x


def graphe(titre, fichier, dates, prix, res, codes, avec_regression=False):
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(11, 7.5), sharex=True,
                                   gridspec_kw={"height_ratios": [3, 1.3]})
    couleurs = {"A": "#555555", "B": "#1f77b4", "C": "#2ca02c", "D": "#ff7f0e",
                "E": "#d62728", "R": "#9467bd",
                "F": "#8c564b", "G": "#e377c2"}
    for code in codes:
        r = res[code]
        eq = r["equity"]
        d = dates[-len(eq):]
        style = "--" if code in ("A", "R") else "-"
        lab = f"{code} {VARIANTES[code][0]} : {r['final']:.0f} €"
        ax1.plot(d, eq, style, color=couleurs[code], lw=1.4, label=lab)
        if avec_regression:
            a, b, x = regression_log(d, eq)
            ax1.plot(d, np.exp(a + b * x), ":", color=couleurs[code], lw=1)
            print(f"   {code} : ln(C) = {a:.3f} + {b:.3f}·t  ->  "
                  f"rendement annuel de tendance = {100*(np.exp(b)-1):+.0f} %/an")
        pic = np.maximum.accumulate(eq)
        ax2.plot(d, -100 * (1 - eq / pic), color=couleurs[code], lw=1, ls=style)
    ax1.axhline(100, color="k", lw=0.6)
    ax1.set_yscale("log")
    ax1.set_ylabel("capital + coffre (€, échelle log)")
    ax1.set_title(titre)
    ax1.legend(fontsize=8, loc="upper left")
    ax1.grid(alpha=0.3, which="both")
    ax2.axhline(-35, color="red", lw=0.8, ls=":")
    ax2.text(dates[-len(res[codes[0]]["equity"])], -33, "seuil de mort (-35 %)", color="red", fontsize=7)
    ax2.set_ylabel("repli depuis le plus haut (%)")
    ax2.grid(alpha=0.3)
    ax2.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    fig.tight_layout()
    os.makedirs(SORTIE, exist_ok=True)
    fig.savefig(os.path.join(SORTIE, fichier), dpi=110)
    plt.close(fig)


def periode(symbole, nom_periode, codes, graphe_ok=True, regression=False):
    dates, prix = charger(symbole)
    d0, d1 = PERIODES[nom_periode]
    t0, t1 = indice(dates, d0), indice(dates, d1)
    if nom_periode == "entrainement":
        t0 = WARMUP
    cache = {}
    res = {c: lancer(c, prix, t0, t1, cache) for c in codes}
    titre = (f"{symbole} — {nom_periode} ({dates[t0]:%d/%m/%Y} → {dates[t1-1]:%d/%m/%Y}), "
             f"prix ×{prix[t1-1]/prix[t0]:.2f}")
    tableau(titre, res)
    if graphe_ok:
        graphe(titre, f"{symbole}_{nom_periode}.png", dates[:t1], prix, res, codes, regression)
    return res


# ------------------------------------------------------------------ phases
def phase_selection():
    tous = list(VARIANTES)
    for sym in ("BTCUSDT", "ETHUSDT"):
        periode(sym, "entrainement", tous)
    val = {sym: periode(sym, "validation", tous) for sym in ("BTCUSDT", "ETHUSDT")}
    vivants = [c for c in BOTS if not val["BTCUSDT"][c]["mort"]]
    choix = max(vivants, key=lambda c: val["BTCUSDT"][c]["final"])
    print(f"\n>>> Choix sur validation BTC : {choix} ({VARIANTES[choix][0]}), "
          f"{val['BTCUSDT'][choix]['final']:.1f} € (acheter-garder : {val['BTCUSDT']['A']['final']:.1f} €)")
    classement_eth = sorted(BOTS, key=lambda c: -val["ETHUSDT"][c]["final"])
    print(f">>> Classement des bots sur validation ETH : {' > '.join(classement_eth)}")


def phase_robustesse():
    """Fenêtres de 2 ans démarrant tous les 3 mois de 12/2017 à 12/2021 (fin ≤ 12/2023)."""
    debuts = [f"{a}-{m:02d}-01" for a in range(2017, 2022) for m in (3, 6, 9, 12)
              if "2017-12-01" <= f"{a}-{m:02d}-01" <= "2021-12-01"]
    print(f"\n=== Départs décalés : {len(debuts)} fenêtres de 2 ans, de {debuts[0]} à {debuts[-1]} ===")
    print("(pour chaque variante : total médian, % de fenêtres battant acheter-garder, % de morts, pire repli médian)")
    for sym in ("BTCUSDT", "ETHUSDT"):
        dates, prix = charger(sym)
        cache, tab = {}, {c: [] for c in VARIANTES}
        for d in debuts:
            t0 = max(indice(dates, d), WARMUP)
            t1 = t0 + 2 * 6 * 365
            for c in VARIANTES:
                tab[c].append(lancer(c, prix, t0, t1, cache))
        print(f"\n{sym}")
        print(f"{'':36s} {'médian €':>9s} {'bat A':>6s} {'morts':>6s} {'repli méd.':>10s}  totaux par fenêtre")
        for c, lst in tab.items():
            f = np.array([r["final"] for r in lst])
            fa = np.array([r["final"] for r in tab["A"]])
            print(f"{c} {VARIANTES[c][0]:34s} {np.median(f):9.1f} {100*np.mean(f > fa):5.0f}% "
                  f"{100*np.mean([r['mort'] for r in lst]):5.0f}% "
                  f"{100*np.median([r['max_dd'] for r in lst]):9.0f}%  "
                  + " ".join(f"{x:.0f}" for x in f))


def phase_test(choix):
    os.makedirs(SORTIE, exist_ok=True)
    if os.path.exists(VERROU) and "--force" not in sys.argv:
        print("La période de test a déjà été ouverte (voir resultats/.test_ouvert). Arrêt.")
        sys.exit(1)
    with open(VERROU, "w") as f:
        f.write(f"ouvert le {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC, variante choisie : {choix}\n")
    print(f"Variante choisie avant ouverture : {choix} ({VARIANTES[choix][0]})")
    for sym in ("BTCUSDT", "ETHUSDT"):
        res = periode(sym, "test", list(VARIANTES))
        print("   Droites de régression (ln du capital en fonction du temps, en années) :")
        dates, prix = charger(sym)
        t1 = indice(dates, PERIODES["test"][1])
        graphe(f"{sym} — TEST : {choix} contre acheter-garder (pointillés = droite de régression)",
               f"{sym}_test_choix.png", dates[:t1], prix, res, ["A", choix], True)


if __name__ == "__main__":
    phase = sys.argv[1] if len(sys.argv) > 1 else "selection"
    if phase == "selection":
        phase_selection()
    elif phase == "robustesse":
        phase_robustesse()
    elif phase == "test":
        phase_test(sys.argv[2])
    else:
        print(__doc__)
