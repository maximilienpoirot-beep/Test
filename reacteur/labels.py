"""Ajoute des étiquettes pédagogiques (qui suivent les pièces) sur les images rendues.

Usage : python labels.py scene.blend <dossier_images> <dossier_sortie>
Les positions 2D sont calculées depuis la caméra Blender pour chaque image.
"""
import math
import os
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector
from PIL import Image, ImageDraw, ImageFont

blend, src, dst = sys.argv[1:4]
bpy.ops.wm.open_mainfile(filepath=blend)
scene = bpy.context.scene
cam = scene.camera
os.makedirs(dst, exist_ok=True)


def center(name, offset=(0, 0, 0)):
    ob = bpy.data.objects[name]
    pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    return sum(pts, Vector()) / 8 + Vector(offset)


def polar(r, a_deg, z):
    a = math.radians(a_deg)
    return Vector((r * math.cos(a), r * math.sin(a), z))


Z_RUSH = center("Rushton disque").z
Z_PBT = center("PBT moyeu").z
# (texte, point 3D, première image, dernière image, côté)
LABELS = [
    ("Moteur électrique", center("Moteur carcasse"), 20, 150, "L"),
    ("Réducteur", center("Réducteur"), 30, 140, "R"),
    ("Double enveloppe", polar(0.84, -100, 1.6), 40, 999, "L"),
    ("Vanne de vidange", center("Vanne corps"), 50, 175, "L"),
    ("Arbre d'agitation", polar(0.0, 0, 2.05), 120, 999, "L"),
    ("Chicane", center("Chicane0"), 150, 999, "R"),
    ("Turbine à pales inclinées", polar(0.1, 200, Z_PBT), 165, 999, "L"),
    ("Turbine Rushton", polar(0.1, 200, Z_RUSH), 180, 999, "L"),
    ("Diffuseur de gaz", polar(0.30, 230, center("Couronne gaz").z), 200, 999, "R"),
]
FADE = 10


def font(size):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


files = sorted(f for f in os.listdir(src) if f.endswith(".png"))
for fn in files:
    frame = int(fn[:4])
    scene.frame_set(frame)
    im = Image.open(os.path.join(src, fn)).convert("RGBA")
    W, H = im.size
    k = W / 1280
    F = font(int(22 * k))
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for text, p, f0, f1, side in LABELS:
        a = min(1.0, (frame - f0) / FADE, (f1 - frame) / FADE)
        if a <= 0:
            continue
        co = world_to_camera_view(scene, cam, p)
        if co.z <= 0 or not (0.03 < co.x < 0.97 and 0.03 < co.y < 0.97):
            continue
        x, y = co.x * W, (1 - co.y) * H
        dx = -1 if side == "L" else 1
        tw = d.textlength(text, font=F)
        ex, ey = x + dx * 70 * k, y - 34 * k
        ex = min(max(ex, 20 * k + (tw if dx < 0 else 0)), W - 20 * k - (tw if dx > 0 else 0))
        A = int(255 * a)
        d.line([(x, y), (ex, ey), (ex + dx * 12 * k, ey)], fill=(255, 255, 255, A), width=max(2, int(2 * k)))
        r = 5 * k
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 140, 40, A), outline=(255, 255, 255, A))
        tx = ex + dx * 18 * k - (tw if dx < 0 else 0)
        pad = 7 * k
        bb = d.textbbox((tx, ey), text, font=F, anchor="lm")
        d.rounded_rectangle([bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad],
                            radius=6 * k, fill=(10, 14, 20, int(170 * a)))
        d.text((tx, ey), text, font=F, anchor="lm", fill=(255, 255, 255, A))
    Image.alpha_composite(im, layer).convert("RGB").save(os.path.join(dst, fn))
print("étiquettes ajoutées :", len(files), "images")
