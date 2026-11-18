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
