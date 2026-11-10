# Réacteur agité : vidéo 3D (Blender)

Vidéo d'environ 12 s d'un réacteur agité en coupe : cuve inox à double enveloppe,
moteur et réducteur, lanterne et accouplement, arbre, turbine Rushton et turbine
à pales inclinées, chicanes, couronne d'injection de gaz avec bulles, liquide
avec vortex, piquages, manomètre, sonde de température, vanne de vidange.

## Fichiers
- `build_reactor.py` : construit toute la scène et l'enregistre en `.blend`
  (ouvrable et modifiable dans Blender 5.x).
- `render.py` : rend une image ou une séquence (reprise possible si interrompu).

## Utilisation
```bash
pip install bpy                     # Blender en module Python (Python 3.13)
python build_reactor.py reacteur.blend
python render.py reacteur.blend still 150 test.png 50 32          # image test
python render.py reacteur.blend anim images 1 288                 # vidéo complète
ffmpeg -framerate 24 -i images/%04d.png -c:v libx264 -crf 18 -pix_fmt yuv420p reacteur.mp4
```

Réglages principaux en haut de `build_reactor.py` : dimensions, niveau de
liquide, vitesse d'agitation (`RPM_REV_PER_S`), secteur de coupe, durée.
