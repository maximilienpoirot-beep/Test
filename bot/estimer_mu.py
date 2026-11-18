"""Estime, sur les données DÉJÀ VUES uniquement, le rendement annuel attendu :
  - μ1 : rendement attendu = μ1 · signal de tendance (signal 0 à 1, vote des MM)
  - μ0 : rendement moyen sans signal (pour la variante ½ Kelly sans tendance)
Régression par l'origine de r(t) (rendement de la bougie) sur s(t-1)."""
import numpy as np
import test_reel as T
from strategie import signal_vote_mm

N_AN = 6 * 365
DEV = [("BTCUSDT", "2017-08-17", "2024-01-01"), ("ETHUSDT", "2017-08-17", "2024-01-01")] + \
      [(s, "2020-01-01", "2026-11-19") for s in open("donnees/univers_altcoins.txt").read().split()]
X, Y, par = [], [], []
for sym, d0, d1 in DEV:
    dates, prix = T.charger(sym)
    s = signal_vote_mm(prix)
    t0, t1 = max(T.indice(dates, d0), T.WARMUP), T.indice(dates, d1)
    r = prix[t0:t1] / prix[t0 - 1:t1 - 1] - 1
    x = s[t0 - 1:t1 - 1]
    X.append(x); Y.append(r)
    par.append((sym[:-4], N_AN * (x @ r) / (x @ x), N_AN * r.mean(),
                *[N_AN * r[x == v].mean() for v in (0, .25, .5, .75, 1)]))
print(f"{'paire':6s} {'μ1':>6s} {'μ0':>6s}   μ annuel selon le signal : 0 / 0,25 / 0,5 / 0,75 / 1")
for p in par:
    print(f"{p[0]:6s} {p[1]:6.2f} {p[2]:6.2f}   " + " ".join(f"{v:6.2f}" for v in p[3:]))
X, Y = np.concatenate(X), np.concatenate(Y)
mu1, mu0 = N_AN * (X @ Y) / (X @ X), N_AN * Y.mean()
# erreur type de μ1 par blocs de 30 jours (rendements pas indépendants)
B = 180
k = len(X) // B
est = [N_AN * (X[i*B:(i+1)*B] @ Y[i*B:(i+1)*B]) for i in range(k)]
den = [(X[i*B:(i+1)*B] @ X[i*B:(i+1)*B]) for i in range(k)]
mu1_b = np.array(est) / np.mean(den)
print(f"\nPoolé : μ1 = {mu1:.2f} (erreur type ≈ {np.std(mu1_b)/np.sqrt(k):.2f}), μ0 = {mu0:.2f}")
print("Moyennes par niveau de signal (poolé) : " +
      " ".join(f"s={v}: {N_AN*Y[X==v].mean():.2f}" for v in (0, .25, .5, .75, 1)))
