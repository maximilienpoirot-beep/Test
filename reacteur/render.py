"""Rend des images du réacteur.

Usage :
  python render.py scene.blend still <frame> <sortie.png> [pourcentage] [échantillons]
  python render.py scene.blend anim <dossier> <debut> <fin> [pourcentage] [échantillons] [pas]
Les images déjà rendues sont sautées (reprise possible).
"""
import os
import sys
import time

import bpy

blend, mode = sys.argv[1], sys.argv[2]
bpy.ops.wm.open_mainfile(filepath=blend)
scene = bpy.context.scene
scene.cycles.device = "CPU"
scene.render.threads_mode = "AUTO"


def opt(i, default, cast):
    return cast(sys.argv[i]) if len(sys.argv) > i else default


if mode == "still":
    frame, out = int(sys.argv[3]), sys.argv[4]
    scene.render.resolution_percentage = opt(5, 100, int)
    scene.cycles.samples = opt(6, scene.cycles.samples, int)
    scene.frame_set(frame)
    scene.render.filepath = out
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print(f"RENDU {out} en {time.time() - t:.1f}s")
else:
    folder, f0, f1 = sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
    scene.render.resolution_percentage = opt(6, 100, int)
    scene.cycles.samples = opt(7, scene.cycles.samples, int)
    step = opt(8, 1, int)
    os.makedirs(folder, exist_ok=True)
    for f in range(f0, f1 + 1, step):
        out = os.path.join(folder, f"{f:04d}.png")
        if os.path.exists(out):
            continue
        scene.frame_set(f)
        scene.render.filepath = out + ".tmp.png"
        t = time.time()
        bpy.ops.render.render(write_still=True)
        os.replace(out + ".tmp.png", out)
        print(f"image {f} en {time.time() - t:.1f}s", flush=True)
