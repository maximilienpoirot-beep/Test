"""
Test sur 12 altcoins jamais vus, selon protocole_altcoins.md (figé avant téléchargement).
Usage : python test_altcoins.py
"""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

import test_reel as T

CODES = ["A", "B", "C", "D", "E", "R", "F", "G"]
DEBUT, FIN = "2020-01-01", "2026-11-19"
FEN = 2 * 6 * 365                       # fenêtre de robustesse : 2 ans
UNIVERS = open(os.path.join(T.ICI, "donnees", "univers_altcoins.txt")).read().split()


def runs_paire(sym):
    dates, prix = T.charger(sym)
    t0, t1 = max(T.indice(dates, DEBUT), T.WARMUP), T.indice(dates, FIN)
    cache = {}
    plein = {c: T.lancer(c, prix, t0, t1, cache) for c in CODES}
    fen = {c: [] for c in CODES}
    debuts = [f"{a}-{m:02d}-01" for a in range(2020, 2025) for m in (1, 4, 7, 10)
              if f"{a}-{m:02d}-01" <= "2024-10-01"]
    for d in debuts:
        u0 = max(T.indice(dates, d), T.WARMUP)
        u1 = u0 + FEN
        if u1 > len(prix):                 # paire retirée avant la fin de la fenêtre
            continue
        for c in CODES:
            fen[c].append(T.lancer(c, prix, u0, u1, cache))
    return dates[t0:t1], prix[t0:t1], plein, fen


def main():
    tout, fenetres = {}, {c: [] for c in CODES}
    print(f"=== Période complète {DEBUT} → 18/11/2026 : total € (pire repli %), * = mort ===")
    print(f"{'':10s}{'prix ×':>7s} " + " ".join(f"{c:>10s}" for c in CODES))
    for sym in UNIVERS:
        d, p, plein, fen = runs_paire(sym)
        tout[sym] = (d, p, plein)
        for c in CODES:
            fenetres[c] += fen[c]
        cell = lambda r: f"{r['final']:6.0f}({100*r['max_dd']:2.0f})" + ("*" if r["mort"] else " ")
        print(f"{sym[:-4]:10s}{p[-1]/p[0]:7.2f} " + " ".join(f"{cell(plein[c]):>10s}" for c in CODES))

    print("\n=== Résumé sur les 12 paires (période complète) ===")
    print(f"{'':36s} {'médian €':>9s} {'moy. géo':>9s} {'> A':>5s} {'> C':>5s} {'morts':>6s} {'repli méd.':>10s}")
    for c in CODES:
        f = np.array([tout[s][2][c]["final"] for s in UNIVERS])
        fa = np.array([tout[s][2]["A"]["final"] for s in UNIVERS])
        fc = np.array([tout[s][2]["C"]["final"] for s in UNIVERS])
        print(f"{c} {T.VARIANTES[c][0]:34s} {np.median(f):9.1f} {np.exp(np.mean(np.log(f))):9.1f} "
              f"{np.sum(f > fa):3d}/12 {np.sum(f > fc):2d}/12 "
              f"{sum(tout[s][2][c]['mort'] for s in UNIVERS):4d}   "
              f"{100*np.median([tout[s][2][c]['max_dd'] for s in UNIVERS]):8.0f}%")

    n = len(fenetres["A"])
    print(f"\n=== Robustesse : {n} fenêtres de 2 ans (12 paires × départs tous les 3 mois 2020-2024) ===")
    print(f"{'':36s} {'médian €':>9s} {'bat A':>6s} {'bat C':>6s} {'morts':>6s} {'repli méd.':>10s}")
    fa = np.array([r["final"] for r in fenetres["A"]])
    fc = np.array([r["final"] for r in fenetres["C"]])
    for c in CODES:
        f = np.array([r["final"] for r in fenetres[c]])
        print(f"{c} {T.VARIANTES[c][0]:34s} {np.median(f):9.1f} {100*np.mean(f > fa):5.0f}% "
              f"{100*np.mean(f > fc):5.0f}% {100*np.mean([r['mort'] for r in fenetres[c]]):5.0f}% "
              f"{100*np.median([r['max_dd'] for r in fenetres[c]]):9.0f}%")

    graphe_paires(tout)
    graphe_regression(fenetres)


def graphe_paires(tout):
    fig, axes = plt.subplots(3, 4, figsize=(15, 9.5), sharex=True)
    coul = {"A": "#555555", "C": "#2ca02c", "G": "#e377c2", "F": "#8c564b"}
    for ax, sym in zip(axes.flat, UNIVERS):
        d, p, plein = tout[sym]
        for c in ("A", "C", "G", "F"):
            eq = plein[c]["equity"]
            ax.plot(d[-len(eq):], eq, "--" if c == "A" else "-", color=coul[c], lw=1,
                    label=f"{c} {plein[c]['final']:.0f} €")
        ax.axhline(100, color="k", lw=0.5)
        ax.set_yscale("log")
        ax.set_title(sym[:-4], fontsize=10)
        ax.legend(fontsize=7, loc="upper left")
        ax.grid(alpha=0.3, which="both")
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%y"))
    fig.suptitle("12 altcoins, 2020 → 11/2026 : A acheter-garder (tirets), C v2 allégée, "
                 "G tendance + creux, F achat à la baisse (€, échelle log)")
    fig.tight_layout()
    fig.savefig(os.path.join(T.SORTIE, "altcoins_courbes.png"), dpi=110)
    plt.close(fig)


def graphe_regression(fenetres):
    """ln(total C / 100) = a + b · ln(total A / 100) : b = part des gains/pertes du marché
    que C encaisse ; a = ce que C gagne quand le marché fait zéro."""
    x = np.log(np.array([r["final"] for r in fenetres["A"]]) / 100)
    fig, ax = plt.subplots(figsize=(8, 6.5))
    for c, coul in (("C", "#2ca02c"), ("G", "#e377c2")):
        y = np.log(np.array([r["final"] for r in fenetres[c]]) / 100)
        b, a = np.polyfit(x, y, 1)
        r2 = np.corrcoef(x, y)[0, 1] ** 2
        ax.scatter(x, y, s=10, alpha=0.5, color=coul)
        xx = np.linspace(x.min(), x.max(), 50)
        ax.plot(xx, a + b * xx, color=coul, lw=2,
                label=f"{c} : ln(C/100) = {a:+.3f} + {b:.3f}·ln(A/100)   (R² = {r2:.2f})")
        print(f"Régression {c} : ln({c}/100) = {a:+.3f} + {b:.3f}·ln(A/100), R² = {r2:.2f}")
    xx = np.linspace(x.min(), x.max(), 50)
    ax.plot(xx, xx, "k:", lw=1, label="y = x (égalité avec acheter-garder)")
    ax.axhline(0, color="k", lw=0.5); ax.axvline(0, color="k", lw=0.5)
    ticks = [10, 25, 50, 100, 200, 500, 1000, 3000]
    ax.set_xticks(np.log(np.array(ticks) / 100)); ax.set_xticklabels(ticks)
    ax.set_yticks(np.log(np.array(ticks[:6]) / 100)); ax.set_yticklabels(ticks[:6])
    ax.set_xlabel("total acheter-garder (€, échelle log)")
    ax.set_ylabel("total du bot (€, échelle log)")
    ax.set_title("Chaque point = une fenêtre de 2 ans sur un altcoin")
    ax.legend(fontsize=8, loc="upper left")
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(os.path.join(T.SORTIE, "altcoins_regression.png"), dpi=110)
    plt.close(fig)


if __name__ == "__main__":
    main()
