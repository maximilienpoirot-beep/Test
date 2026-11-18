"""Pourquoi « tout investi » n'est pas le maximum de rendement : critère de Kelly sur données réelles.
Portefeuille rééquilibré à chaque bougie avec une fraction f fixe en crypto (le reste en cash).
Théorie : croissance log annuelle g(f) = f·μ − f²·σ²/2  ->  maximum en f* = μ/σ²."""
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import test_reel as T

N_AN = 6 * 365
F = np.linspace(0, 3, 121)
CAS = [("BTCUSDT", "2017-08-17", "2024-01-01"), ("ETHUSDT", "2017-08-17", "2024-01-01")] + \
      [(s, "2020-01-01", "2026-11-19") for s in open("donnees/univers_altcoins.txt").read().split()]

fig, ax = plt.subplots(figsize=(10, 6.5))
print(f"{'paire':9s} {'μ (an)':>8s} {'σ (an)':>7s} {'f* = μ/σ²':>10s} {'g(f*)':>7s} {'g(1)':>7s} {'g(0,5 f*)':>9s}")
for sym, d0, d1 in CAS:
    dates, prix = T.charger(sym)
    p = prix[T.indice(dates, d0):T.indice(dates, d1)]
    r = p[1:] / p[:-1] - 1                                  # rendements simples par bougie
    mu, s2 = r.mean() * N_AN, r.var() * N_AN
    fstar = mu / s2
    g_simu = np.array([np.log1p(f * r).sum() for f in F]) / (len(r) / N_AN)   # simulation exacte
    g_theo = F * mu - F ** 2 * s2 / 2
    print(f"{sym[:-4]:9s} {mu:8.2f} {np.sqrt(s2):7.2f} {fstar:10.2f} {fstar*mu/2:7.2f} "
          f"{mu - s2/2:7.2f} {0.75*fstar*mu/2:9.2f}")
    if sym in ("BTCUSDT", "ETHUSDT"):
        l, = ax.plot(F, g_simu, lw=2, label=f"{sym[:-4]} 2017-2023 (simulation)")
        ax.plot(F, g_theo, ":", color=l.get_color(), lw=1.5,
                label=f"   théorie : g(f) = {mu:.2f}·f − {s2/2:.2f}·f²   →  f* = {fstar:.2f}")
        ax.plot([fstar], [fstar * mu / 2], "o", color=l.get_color())
ax.axvline(1, color="k", lw=0.8, ls="--"); ax.text(1.02, ax.get_ylim()[0] * 0.9, "tout investi (f = 1)")
ax.axhline(0, color="k", lw=0.5)
ax.set_xlabel("fraction du capital investie f (au-delà de 1 = levier)")
ax.set_ylabel("croissance annuelle g (log)  ;  rendement = e^g − 1")
ax.set_title("Plus de risque ≠ plus de rendement : la croissance est une parabole en f")
ax.legend(fontsize=8); ax.grid(alpha=0.3)
fig.tight_layout(); fig.savefig("resultats/kelly.png", dpi=110)

# probabilité de passer un jour sous 65 % de son plus haut, en fonction de la fraction de Kelly c
# (formule du mouvement brownien : P = x^(2/c − 1), x = 0,65)
print("\nP(tomber un jour sous 65 % du plus haut) selon la fraction de Kelly c (horizon infini) :")
for c in (0.25, 0.5, 0.75, 1.0, 1.5, 2.0):
    print(f"  c = {c:4.2f} × f*  ->  croissance = {c*(2-c):4.0%} du maximum, P(mort) = {min(1, 0.65 ** (2/c - 1)):4.0%}")
