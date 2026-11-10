"""Construit la scène Blender d'un réacteur agité (vue en coupe) et l'enregistre.

Usage : python build_reactor.py <sortie.blend>
(nécessite le module `bpy`, c.-à-d. Blender en module Python : pip install bpy)
"""
import math
import random
import sys

import bpy  # doit précéder bmesh
import bmesh
from mathutils import Matrix, Vector

random.seed(7)
TAU = math.tau
rad = math.radians

# --------------------------------------------------------------------------
# Paramètres géométriques (mètres)
# --------------------------------------------------------------------------
ZB = 0.35            # hauteur de la cuve au-dessus du sol
R = 0.75             # rayon intérieur de la cuve
T_SHELL = 0.018      # épaisseur de virole
Z0 = ZB + 0.62       # ligne de tangence du fond
HB = 0.32            # profondeur du fond bombé
Z1 = ZB + 2.30       # haut de la virole
HT = 0.20            # profondeur du couvercle bombé
ZL = ZB + 1.95       # niveau du liquide
RJ = 0.86            # rayon intérieur de la double enveloppe
ZJ0, ZJ1 = ZB + 0.72, ZB + 2.08
Z_RUSHTON = ZB + 0.80
Z_PBT = ZB + 1.42
Z_SPARGER = ZB + 0.55
SEG = 160            # segments de révolution

# Coupe : on retire un quart (centré face à la caméra)
CUT_A0, CUT_A1 = rad(-100), rad(-10)          # secteur retiré
KEEP_A0, KEEP_A1 = CUT_A1, CUT_A0 + TAU       # secteur conservé (-10° -> 260°)

FPS = 24
FRAMES = 12 * FPS
RPM_REV_PER_S = 1.25                          # vitesse d'agitation à l'écran


def in_cut(a):
    a = (a - CUT_A0) % TAU
    return a < (CUT_A1 - CUT_A0)


# --------------------------------------------------------------------------
# Scène vide
# --------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 1, FRAMES
COL = scene.collection


# --------------------------------------------------------------------------
# Matériaux
# --------------------------------------------------------------------------
def principled(name, color, metallic=0.0, rough=0.5, **kw):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    for k, v in kw.items():
        b.inputs[k].default_value = v
    return m, nt, b


def rough_noise(nt, bsdf, lo, hi, scale=6.0, stretch=(1, 1, 1)):
    """Variation de rugosité (aspect métal réel, non parfait)."""
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = stretch
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale
    nz.inputs["Detail"].default_value = 8
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["To Min"].default_value = lo
    mr.inputs["To Max"].default_value = hi
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
    nt.links.new(nz.outputs["Fac"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], bsdf.inputs["Roughness"])
    return nz


def make_materials():
    M = {}
    # Inox brossé (stries verticales via bruit étiré)
    m, nt, b = principled("Inox brossé", (0.80, 0.80, 0.82), 1.0, 0.2)
    rough_noise(nt, b, 0.14, 0.30, scale=30, stretch=(6, 6, 0.15))
    M["inox"] = m
    m, nt, b = principled("Inox poli", (0.86, 0.86, 0.88), 1.0, 0.08)
    rough_noise(nt, b, 0.05, 0.13, scale=8)
    M["poli"] = m
    m, nt, b = principled("Coupe", (0.95, 0.30, 0.05), 0.0, 0.45)
    M["coupe"] = m
    m, nt, b = principled("Peinture moteur", (0.012, 0.05, 0.20), 0.0, 0.38,
                          **{"Coat Weight": 0.2, "Coat Roughness": 0.15})
    rough_noise(nt, b, 0.25, 0.42, scale=4)
    M["moteur"] = m
    m, nt, b = principled("Peinture structure", (0.16, 0.17, 0.18), 0.0, 0.45,
                          **{"Coat Weight": 0.2})
    M["structure"] = m
    m, nt, b = principled("Caoutchouc", (0.02, 0.02, 0.02), 0.0, 0.7)
    M["noir"] = m
    m, nt, b = principled("Poignée rouge", (0.55, 0.02, 0.02), 0.0, 0.3,
                          **{"Coat Weight": 0.5})
    M["rouge"] = m
    m, nt, b = principled("Tuyau chaud", (0.45, 0.06, 0.03), 0.0, 0.35,
                          **{"Coat Weight": 0.3})
    M["chaud"] = m
    m, nt, b = principled("Tuyau froid", (0.03, 0.20, 0.45), 0.0, 0.35,
                          **{"Coat Weight": 0.3})
    M["froid"] = m
    m, nt, b = principled("Cadran", (0.9, 0.9, 0.88), 0.0, 0.2,
                          **{"Coat Weight": 1.0})
    M["cadran"] = m
    m, nt, b = principled("Joint", (0.08, 0.08, 0.09), 0.0, 0.6)
    M["joint"] = m

    # Liquide (style « écorché ») : le corps est limpide et teinté par son volume,
    # seule la surface libre réfléchit/réfracte comme de l'eau.
    def liquid_volume(nt):
        out = nt.nodes.get("Material Output")
        va = nt.nodes.new("ShaderNodeVolumeAbsorption")
        va.inputs["Color"].default_value = (0.20, 0.72, 0.66, 1)
        va.inputs["Density"].default_value = 1.4
        nt.links.new(va.outputs[0], out.inputs["Volume"])

    m = bpy.data.materials.new("Liquide (corps)")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.remove(nt.nodes.get("Principled BSDF"))
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    gl = nt.nodes.new("ShaderNodeBsdfGlossy")
    gl.inputs["Roughness"].default_value = 0.15
    fr = nt.nodes.new("ShaderNodeLayerWeight")
    fr.inputs["Blend"].default_value = 0.08
    mx = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(fr.outputs["Fresnel"], mx.inputs["Fac"])
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(gl.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], nt.nodes.get("Material Output").inputs["Surface"])
    liquid_volume(nt)
    M["liquide"] = m
    m, nt, b = principled("Liquide (surface)", (1, 1, 1), 0.0, 0.02,
                          **{"Transmission Weight": 1.0, "IOR": 1.33})
    liquid_volume(nt)
    M["surface"] = m
    m, nt, b = principled("Verre", (1, 1, 1), 0.0, 0.0,
                          **{"Transmission Weight": 1.0, "IOR": 1.5})
    M["verre"] = m

    m, nt, b = principled("Bulle", (1, 1, 1), 0.0, 0.0,
                          **{"Transmission Weight": 1.0, "IOR": 1.12})
    M["bulle"] = m

    # Sol : résine époxy sombre légèrement réfléchissante
    m, nt, b = principled("Sol", (0.05, 0.052, 0.056), 0.0, 0.35)
    nz = rough_noise(nt, b, 0.22, 0.55, scale=0.8)
    nz.inputs["Detail"].default_value = 12
    M["sol"] = m
    return M


MAT = make_materials()


# --------------------------------------------------------------------------
# Outils de géométrie
# --------------------------------------------------------------------------
def link(name, bm, mats, parent=None, smooth=True, split=35):
    me = bpy.data.meshes.new(name)
    if smooth:
        for f in bm.faces:
            f.smooth = True
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    for m in (mats if isinstance(mats, (list, tuple)) else [mats]):
        me.materials.append(m)
    COL.objects.link(ob)
    if parent:
        ob.parent = parent
    if smooth and split:
        es = ob.modifiers.new("EdgeSplit", "EDGE_SPLIT")
        es.split_angle = rad(split)
    return ob


def lathe_bm(profile, a0=0.0, a1=TAU, seg=SEG, closed=False, caps=False):
    """Surface de révolution d'un profil [(r, z), ...] autour de Z.

    Profil parcouru « vers le haut » => normales vers l'extérieur.
    """
    bm = bmesh.new()
    full = abs((a1 - a0) - TAU) < 1e-6
    n_ang = seg if full else seg + 1
    axis = {}
    rings = []
    for i in range(n_ang):
        a = a0 + (a1 - a0) * i / seg
        ca, sa = math.cos(a), math.sin(a)
        ring = []
        for j, (r, z) in enumerate(profile):
            if r < 1e-7:
                if j not in axis:
                    axis[j] = bm.verts.new((0, 0, z))
                ring.append(axis[j])
            else:
                ring.append(bm.verts.new((r * ca, r * sa, z)))
        rings.append(ring)
    np_ = len(profile)
    jr = range(np_) if closed else range(np_ - 1)
    ir = range(n_ang) if full else range(n_ang - 1)
    for i in ir:
        i2 = (i + 1) % n_ang
        for j in jr:
            j2 = (j + 1) % np_
            vs = [rings[i][j], rings[i2][j], rings[i2][j2], rings[i][j2]]
            uniq = []
            for v in vs:
                if v not in uniq:
                    uniq.append(v)
            if len(uniq) >= 3:
                bm.faces.new(uniq)
    if caps and not full:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    if caps or closed:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def shell(name, profile, thick, a0=KEEP_A0, a1=KEEP_A1, mat=None, seg=SEG):
    """Paroi mince avec épaisseur ; les tranches de coupe en orange."""
    bm = lathe_bm(profile, a0, a1, seg)
    ob = link(name, bm, [mat or MAT["inox"], MAT["coupe"]], split=0)
    so = ob.modifiers.new("Epaisseur", "SOLIDIFY")
    so.thickness = thick
    so.offset = 1.0
    so.use_rim = True
    so.use_even_offset = True
    so.material_offset_rim = 1
    es = ob.modifiers.new("EdgeSplit", "EDGE_SPLIT")
    es.split_angle = rad(35)
    return ob


def solid_ring(name, r0, r1, z0, z1, mat, a0=KEEP_A0, a1=KEEP_A1, seg=SEG, cut_mat=True):
    prof = [(r0, z0), (r1, z0), (r1, z1), (r0, z1)]
    bm = lathe_bm(prof, a0, a1, seg, closed=True, caps=abs(a1 - a0 - TAU) > 1e-6)
    ob = link(name, bm, [mat, MAT["coupe"]] if cut_mat else mat)
    if cut_mat and abs(a1 - a0 - TAU) > 1e-6:
        # faces planes de coupe => matériau orange
        me = ob.data
        for p in me.polygons:
            n = p.normal
            if abs(n.z) < 0.2 and p.area > 0 and len(p.vertices) == 4:
                c = p.center
                ang = math.atan2(c.y, c.x)
                radial = Vector((math.cos(ang), math.sin(ang), 0))
                if abs(n.dot(radial)) < 0.2:
                    p.material_index = 1
    return ob


def cyl(name, r, z0, z1, mat, xy=(0, 0), seg=64, parent=None, rot=None, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r,
                          radius2=r if r2 is None else r2, depth=z1 - z0)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, (z0 + z1) / 2))
    if rot is not None:
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=rot)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(xy[0], xy[1], 0))
    ob = link(name, bm, mat, parent)
    bev(ob, 0.003)
    return ob


def box(name, size, loc, mat, rot_z=0.0, parent=None, bevel=0.004, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    m = rot if rot is not None else Matrix.Rotation(rot_z, 3, "Z")
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=m)
    bmesh.ops.translate(bm, verts=bm.verts, vec=loc)
    ob = link(name, bm, mat, parent, smooth=True, split=30)
    if bevel:
        bev(ob, bevel)
    return ob


def bev(ob, w, segs=2):
    b = ob.modifiers.new("Chanfrein", "BEVEL")
    b.width = w
    b.segments = segs
    b.limit_method = "ANGLE"
    b.angle_limit = rad(40)
    b.harden_normals = False
    # le chanfrein doit passer avant l'EdgeSplit
    if "EdgeSplit" in ob.modifiers:
        idx = list(ob.modifiers).index(b)
        ob.modifiers.move(idx, 0)


def torus(name, R0, r0, z, mat, seg=SEG, seg2=24, parent=None):
    prof = [(R0 + r0 * math.cos(t), z + r0 * math.sin(t))
            for t in [TAU * k / seg2 for k in range(seg2)]]
    bm = lathe_bm(prof, 0, TAU, seg, closed=True)
    return link(name, bm, mat, parent, split=0)


def pipe(name, pts, radius, mat, res=6):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 6
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for p, c in zip(sp.points, pts):
        p.co = (*c, 1)
    ob = bpy.data.objects.new(name, cu)
    cu.materials.append(mat)
    COL.objects.link(ob)
    return ob


def rounded_path(pts, rad_bend=0.12, n=8):
    """Arrondit les coudes d'une polyligne (coudes de tuyauterie)."""
    P = [Vector(p) for p in pts]
    out = [P[0]]
    for i in range(1, len(P) - 1):
        a, b, c = P[i - 1], P[i], P[i + 1]
        d1 = (b - a).normalized()
        d2 = (c - b).normalized()
        r = min(rad_bend, (b - a).length / 2, (c - b).length / 2)
        p0, p2 = b - d1 * r, b + d2 * r
        for k in range(n + 1):
            t = k / n
            out.append((1 - t) ** 2 * p0 + 2 * (1 - t) * t * b + t * t * p2)
    out.append(P[-1])
    return [tuple(v) for v in out]


def flange(name, r_in, r_out, z, h, mat, xy=(0, 0), nbolts=8, parent=None):
    objs = [solid_ring(name, r_in, r_out, z, z + h, mat, 0, TAU, seg=64, cut_mat=False)]
    objs[0].location = (*xy, 0)
    rb = (r_in + r_out) / 2
    for k in range(nbolts):
        a = TAU * k / nbolts + 0.2
        x, y = xy[0] + rb * math.cos(a), xy[1] + rb * math.sin(a)
        objs.append(cyl(f"{name}_ecrou{k}", (r_out - r_in) * 0.16, z + h, z + h + h * 0.7,
                        MAT["poli"], (x, y), seg=6))
    if parent:
        for o in objs:
            o.parent = parent
    return objs


# --------------------------------------------------------------------------
# Cuve
# --------------------------------------------------------------------------
def head_profile(z_tan, depth, r, n=40, r_min=0.0, up=False):
    pts = []
    phi_end = math.acos(min(1.0, r_min / r)) if r_min > 0 else math.pi / 2
    for k in range(n + 1):
        phi = phi_end * k / n
        rr = r * math.cos(phi)
        zz = depth * math.sin(phi)
        pts.append((max(rr, 0.0) if r_min == 0 or k < n else r_min, z_tan + (zz if up else -zz)))
    return pts


# virole + fond (profil du centre bas vers le haut)
bottom = list(reversed(head_profile(Z0, HB, R)))           # axe -> paroi
bottom[0] = (0.0, bottom[0][1])
straight = [(R, Z0 + (Z1 - Z0) * k / 30) for k in range(1, 31)]
shell("Cuve", bottom + straight, T_SHELL)

# couvercle bombé (de la paroi vers la tubulure centrale)
Z_LID = Z1 + 0.12
lid = head_profile(Z_LID, HT, R + T_SHELL, n=40, r_min=0.11, up=True)
lid_ob = shell("Couvercle", lid, T_SHELL)
lid_ob.modifiers["Epaisseur"].offset = -1.0

# brides corps / couvercle + joint + boulonnerie
solid_ring("Bride corps", R, R + 0.11, Z1 - 0.005, Z1 + 0.055, MAT["inox"])
solid_ring("Joint", R + 0.005, R + 0.10, Z1 + 0.055, Z1 + 0.065, MAT["joint"])
solid_ring("Bride couvercle", R, R + 0.11, Z1 + 0.065, Z_LID, MAT["inox"])
NB = 32
for k in range(NB):
    a = TAU * (k + 0.5) / NB
    if in_cut(a) or in_cut(a - 0.04) or in_cut(a + 0.04):
        continue
    x, y = (R + 0.075) * math.cos(a), (R + 0.075) * math.sin(a)
    cyl(f"Tige{k}", 0.009, Z1 - 0.04, Z_LID + 0.04, MAT["poli"], (x, y), seg=12)
    cyl(f"Ecrou_h{k}", 0.017, Z_LID, Z_LID + 0.022, MAT["poli"], (x, y), seg=6)
    cyl(f"Ecrou_b{k}", 0.017, Z1 - 0.027, Z1 - 0.005, MAT["poli"], (x, y), seg=6)

# double enveloppe (chauffage / refroidissement)
RO = R + T_SHELL
jacket = [(RO, ZJ0), (RJ, ZJ0), (RJ, ZJ0 + 0.03)] + \
         [(RJ, ZJ0 + 0.03 + (ZJ1 - ZJ0 - 0.06) * k / 24) for k in range(1, 25)] + \
         [(RJ, ZJ1), (RO, ZJ1)]
shell("Double enveloppe", jacket, 0.012)

# chicanes (4, celle dans le quart retiré est absente)
for k, a in enumerate([rad(35), rad(125), rad(215), rad(305)]):
    if in_cut(a):
        continue
    rc = R - 0.025 - 0.065
    ob = box(f"Chicane{k}", (0.13, 0.012, Z1 - 0.12 - (Z0 + 0.02)),
             (rc * math.cos(a), rc * math.sin(a), (Z1 - 0.12 + Z0 + 0.02) / 2),
             MAT["inox"], rot_z=a, bevel=0.002)
    for zz in (Z0 + 0.15, Z1 - 0.3):
        box(f"Patte{k}_{zz:.1f}", (0.04, 0.03, 0.03),
            ((R - 0.012) * math.cos(a), (R - 0.012) * math.sin(a), zz),
            MAT["inox"], rot_z=a, bevel=0.002)

# --------------------------------------------------------------------------
# Liquide (même quart retiré) avec léger vortex
# --------------------------------------------------------------------------
RL = R - 0.003
liq = list(reversed(head_profile(Z0, HB - 0.003, RL)))
liq[0] = (0.0, liq[0][1])
liq += [(RL, Z0 + (ZL - Z0) * k / 20) for k in range(1, 21)]
NTOP = 36
for k in range(1, NTOP + 1):
    r = RL * (1 - k / NTOP)
    liq.append((r, ZL - 0.05 * math.exp(-(r / 0.22) ** 2)))
bm = lathe_bm(liq, KEEP_A0, KEEP_A1, SEG, caps=True)
top_ids = [v.index for v in bm.verts if v.co.z > ZL - 0.06 and (v.co.xy.length < RL - 1e-4 or v.co.z > ZL - 1e-4)]
top_set = set(top_ids)
for f in bm.faces:
    if all(v.index in top_set for v in f.verts) and f.normal.z > 0.3:
        f.material_index = 1
liquid = link("Liquide", bm, [MAT["liquide"], MAT["surface"]], split=0)
vg = liquid.vertex_groups.new(name="surface")
vg.add(top_ids, 1.0, "REPLACE")
waves_empty = bpy.data.objects.new("Ondes", None)
COL.objects.link(waves_empty)
tex = bpy.data.textures.new("Ondes", "CLOUDS")
tex.noise_scale = 0.18
tex.noise_depth = 2
dm = liquid.modifiers.new("Ondes", "DISPLACE")
dm.texture = tex
dm.direction = "Z"
dm.strength = 0.03
dm.mid_level = 0.5
dm.vertex_group = "surface"
dm.texture_coords = "OBJECT"
dm.texture_coords_object = waves_empty
for i, expr in ((2, "frame*0.035"),):
    waves_empty.driver_add("rotation_euler", i).driver.expression = expr
waves_empty.driver_add("location", 2).driver.expression = "frame*0.006"
liquid.visible_shadow = True

# --------------------------------------------------------------------------
# Agitateur : arbre + turbine Rushton + turbine à pales inclinées
# --------------------------------------------------------------------------
rotor = bpy.data.objects.new("Rotor", None)
COL.objects.link(rotor)
rotor.driver_add("rotation_euler", 2).driver.expression = \
    f"frame*{TAU * RPM_REV_PER_S / FPS:.6f}"

Z_SHAFT_TOP = ZB + 3.05
cyl("Arbre", 0.035, Z_RUSHTON - 0.12, Z_SHAFT_TOP, MAT["poli"], parent=rotor, seg=48)
# Rushton : disque + moyeu + 6 pales
cyl("Rushton disque", 0.19, Z_RUSHTON - 0.006, Z_RUSHTON + 0.006, MAT["poli"], parent=rotor)
cyl("Rushton moyeu", 0.06, Z_RUSHTON - 0.06, Z_RUSHTON + 0.06, MAT["poli"], parent=rotor)
for k in range(6):
    a = TAU * k / 6
    box(f"Rushton pale{k}", (0.125, 0.01, 0.10),
        (0.1875 * math.cos(a), 0.1875 * math.sin(a), Z_RUSHTON), MAT["poli"],
        rot_z=a, parent=rotor, bevel=0.002)
# pales inclinées à 45° (4)
cyl("PBT moyeu", 0.06, Z_PBT - 0.05, Z_PBT + 0.05, MAT["poli"], parent=rotor)
for k in range(4):
    a = TAU * k / 4 + rad(20)
    m = Matrix.Rotation(a, 3, "Z") @ Matrix.Rotation(rad(45), 3, "X")
    box(f"PBT pale{k}", (0.20, 0.010, 0.09),
        (0.155 * math.cos(a), 0.155 * math.sin(a), Z_PBT), MAT["poli"],
        parent=rotor, bevel=0.002, rot=m)
# accouplement dans la lanterne (tourne avec l'arbre)
Z_LANT0, Z_LANT1 = ZB + 2.78, ZB + 3.18
cyl("Accouplement", 0.075, Z_LANT0 + 0.17, Z_LANT0 + 0.27, MAT["poli"], parent=rotor, seg=48)
for k in range(6):
    a = TAU * k / 6
    cyl(f"Acc_boulon{k}", 0.010, Z_LANT0 + 0.165, Z_LANT0 + 0.275, MAT["noir"],
        (0.055 * math.cos(a), 0.055 * math.sin(a)), seg=8, parent=rotor)

# --------------------------------------------------------------------------
# Entraînement : tubulure, garniture, lanterne, réducteur, moteur
# --------------------------------------------------------------------------
Z_NECK0 = Z_LID + HT - 0.03
solid_ring("Tubulure centrale", 0.09, 0.11, Z_NECK0, Z_LANT0 - 0.03, MAT["inox"], 0, TAU, 64, False)
cyl("Bride centrale", 0.20, Z_LANT0 - 0.03, Z_LANT0, MAT["inox"])
cyl("Garniture méca", 0.07, Z_LANT0, Z_LANT0 + 0.12, MAT["inox"], seg=48)
cyl("Garniture bague", 0.08, Z_LANT0 + 0.03, Z_LANT0 + 0.05, MAT["noir"], seg=48)
cyl("Lanterne bas", 0.23, Z_LANT0, Z_LANT0 + 0.025, MAT["structure"])
cyl("Lanterne haut", 0.23, Z_LANT1 - 0.025, Z_LANT1, MAT["structure"])
for k in range(4):
    a = TAU * k / 4 + rad(45 + 10)
    box(f"Lanterne montant{k}", (0.07, 0.035, Z_LANT1 - Z_LANT0),
        (0.20 * math.cos(a), 0.20 * math.sin(a), (Z_LANT0 + Z_LANT1) / 2),
        MAT["structure"], rot_z=a, bevel=0.006)
# réducteur
Z_GB0, Z_GB1 = Z_LANT1, Z_LANT1 + 0.34
box("Réducteur", (0.50, 0.40, Z_GB1 - Z_GB0), (0.04, 0, (Z_GB0 + Z_GB1) / 2), MAT["moteur"], bevel=0.04)
for k in range(5):
    box(f"Réducteur nervure{k}", (0.02, 0.44, Z_GB1 - Z_GB0 - 0.06),
        (-0.14 + k * 0.09, 0, (Z_GB0 + Z_GB1) / 2), MAT["moteur"], bevel=0.008)
box("Bouchon huile", (0.05, 0.05, 0.04), (0.20, 0.16, Z_GB1 + 0.02), MAT["noir"], bevel=0.008)
# moteur vertical à ailettes
Z_M0, Z_M1 = Z_GB1, Z_GB1 + 0.52
cyl("Moteur bride", 0.20, Z_M0, Z_M0 + 0.04, MAT["moteur"])
cyl("Moteur carcasse", 0.165, Z_M0 + 0.04, Z_M1, MAT["moteur"], seg=64)
for k in range(28):
    a = TAU * k / 28
    box(f"Ailette{k}", (0.03, 0.006, Z_M1 - Z_M0 - 0.10),
        (0.18 * math.cos(a), 0.18 * math.sin(a), (Z_M0 + Z_M1) / 2 + 0.01),
        MAT["moteur"], rot_z=a, bevel=0.002)
cyl("Capot ventilateur", 0.175, Z_M1, Z_M1 + 0.14, MAT["moteur"], seg=64, r2=0.165)
cyl("Grille", 0.15, Z_M1 + 0.14, Z_M1 + 0.145, MAT["noir"], seg=64)
for k in range(7):
    torus(f"Grille anneau{k}", 0.02 + k * 0.02, 0.004, Z_M1 + 0.147, MAT["moteur"], seg=48, seg2=8)
box("Boîte à bornes", (0.12, 0.16, 0.14), (-0.22, 0, Z_M0 + 0.28), MAT["moteur"], bevel=0.012)
box("Presse-étoupe", (0.04, 0.04, 0.04), (-0.22, -0.09, Z_M0 + 0.24), MAT["noir"], bevel=0.008)
box("Plaque signalétique", (0.002, 0.10, 0.06), (0.0, 0, 0), MAT["poli"], bevel=0)
bpy.data.objects["Plaque signalétique"].location = (0.183 * math.cos(rad(-40)), 0.183 * math.sin(rad(-40)), Z_M0 + 0.30)
bpy.data.objects["Plaque signalétique"].rotation_euler.z = rad(-40)

# --------------------------------------------------------------------------
# Piquages du couvercle, sonde, manomètre, trou d'homme
# --------------------------------------------------------------------------
def lid_z(r):
    rr = min(r / (R + T_SHELL), 1.0)
    return Z_LID + HT * math.sqrt(1 - rr * rr) + T_SHELL


def nozzle(name, a, r, rad_n, h, cover=True):
    x, y = r * math.cos(a), r * math.sin(a)
    z = lid_z(r) - 0.03
    solid_ring(name, rad_n - 0.008, rad_n, z, z + h, MAT["inox"], 0, TAU, 48, False).location = (x, y, 0)
    flange(name + " bride", rad_n - 0.008, rad_n + 0.05, z + h, 0.025, MAT["inox"], (x, y),
           nbolts=8 if rad_n < 0.1 else 16)
    if cover:
        cyl(name + " tape", rad_n + 0.05, z + h + 0.025, z + h + 0.045, MAT["inox"], (x, y), seg=48)
    return x, y, z + h + 0.045


# trou d'homme
nozzle("Trou d'homme", rad(150), 0.42, 0.20, 0.16)
# piquage alimentation + tuyau
x, y, zt = nozzle("Alimentation", rad(60), 0.48, 0.05, 0.16, cover=False)
pipe("Ligne alimentation",
     rounded_path([(x, y, zt - 0.02), (x, y, zt + 0.45), (x, y + 6.0, zt + 0.45)], 0.15), 0.045, MAT["inox"])
# manomètre
x, y, zt = nozzle("Manomètre piquage", rad(240), 0.50, 0.035, 0.12)
cyl("Manomètre tige", 0.010, zt, zt + 0.10, MAT["poli"], (x, y), seg=12)
rot_g = Matrix.Rotation(rad(90), 3, "X")
gx, gy = x, y
gauge = cyl("Manomètre boîtier", 0.07, -0.02, 0.02, MAT["poli"], seg=48, rot=rot_g)
gauge.location = (gx, gy, zt + 0.17)
gauge.rotation_euler.z = rad(240 + 90 + 30)
face = cyl("Manomètre cadran", 0.062, 0.0201, 0.0215, MAT["cadran"], seg=48, rot=rot_g)
face.parent = gauge
needle = box("Aiguille", (0.004, 0.003, 0.05), (0, -0.0225, 0.015), MAT["rouge"], bevel=0)
needle.parent = gauge
needle.rotation_euler.y = rad(35)
# sonde de température (plonge dans le liquide)
x, y, zt = nozzle("Sonde piquage", rad(15), 0.52, 0.03, 0.10)
cyl("Sonde", 0.012, ZL - 0.55, zt + 0.06, MAT["poli"], (x, y), seg=16)
box("Transmetteur", (0.08, 0.08, 0.09), (x, y, zt + 0.10), MAT["poli"], bevel=0.015)
# hublot éclairé + lampe
x, y, zt = nozzle("Hublot", rad(105), 0.50, 0.06, 0.10, cover=False)
cyl("Verre hublot", 0.07, zt - 0.02, zt - 0.012, MAT["verre"], (x, y), seg=48)

# --------------------------------------------------------------------------
# Diffuseur de gaz (couronne) + alimentation gaz
# --------------------------------------------------------------------------
R_SP = 0.30
torus("Couronne gaz", R_SP, 0.018, Z_SPARGER, MAT["inox"], seg=96, seg2=16)
a_sp = rad(160)
pipe("Ligne gaz",
     rounded_path([(R_SP * math.cos(a_sp), R_SP * math.sin(a_sp), Z_SPARGER),
                   (0.62 * math.cos(a_sp), 0.62 * math.sin(a_sp), Z_SPARGER),
                   (0.62 * math.cos(a_sp), 0.62 * math.sin(a_sp), lid_z(0.62) + 0.25),
                   (0.62 * math.cos(a_sp) - 0.3, 0.62 * math.sin(a_sp) + 6.0, lid_z(0.62) + 0.25)], 0.1),
     0.02, MAT["inox"])

# --------------------------------------------------------------------------
# Vidange en fond : piquage, vanne à boisseau, coude
# --------------------------------------------------------------------------
Z_APEX = Z0 - HB
cyl("Vidange piquage", 0.05, Z_APEX - 0.12, Z_APEX + 0.02, MAT["inox"], seg=48)
cyl("Vidange bride", 0.09, Z_APEX - 0.14, Z_APEX - 0.115, MAT["inox"], seg=48)
cyl("Vanne bride h", 0.09, Z_APEX - 0.165, Z_APEX - 0.14, MAT["inox"], seg=48)
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=0.085)
bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, Z_APEX - 0.24))
link("Vanne corps", bm, MAT["inox"], split=0)
cyl("Vanne bride b", 0.09, Z_APEX - 0.34, Z_APEX - 0.315, MAT["inox"], seg=48)
cyl("Vanne axe", 0.012, 0, 0.12, MAT["poli"], seg=12,
    rot=Matrix.Rotation(rad(90), 3, "Y")).location = (0.06, 0, Z_APEX - 0.24)
box("Vanne levier", (0.30, 0.03, 0.012), (0.24, -0.05, Z_APEX - 0.24), MAT["rouge"],
    rot_z=rad(-20), bevel=0.005)
pipe("Ligne vidange",
     rounded_path([(0, 0, Z_APEX - 0.34), (0, 0, 0.13), (0, 1.0, 0.13), (0, 2.6, 0.13)], 0.14),
     0.045, MAT["inox"])

# --------------------------------------------------------------------------
# Piquages double enveloppe (fluide caloporteur)
# --------------------------------------------------------------------------
def jacket_pipe(name, a, z, mat, pts_out):
    x, y = (RJ + 0.012) * math.cos(a), (RJ + 0.012) * math.sin(a)
    xo, yo = (RJ + 0.16) * math.cos(a), (RJ + 0.16) * math.sin(a)
    pipe(name, rounded_path([(x, y, z), (xo, yo, z)] + pts_out(xo, yo, z), 0.12), 0.035, mat)
    flange(name + " bride", 0.035, 0.07, 0, 0.02, MAT["inox"], nbolts=6)
    for o in [o for o in bpy.data.objects if o.name.startswith(name + " bride")]:
        o.matrix_world = (Matrix.Translation(((RJ + 0.08) * math.cos(a), (RJ + 0.08) * math.sin(a), z))
                          @ Matrix.Rotation(a, 4, "Z") @ Matrix.Rotation(rad(90), 4, "Y")
                          @ o.matrix_world)


jacket_pipe("Entrée fluide", rad(200), ZJ0 + 0.12, MAT["froid"],
            lambda x, y, z: [(x, y, 0.06), (x - 0.8, y - 0.2, 0.06)])
jacket_pipe("Sortie fluide", rad(20), ZJ1 - 0.12, MAT["chaud"],
            lambda x, y, z: [(x + 0.35, y + 0.12, z), (x + 0.35, y + 0.12, 0.06), (x + 1.2, y + 0.9, 0.06)])

# --------------------------------------------------------------------------
# Pieds + consoles
# --------------------------------------------------------------------------
Z_LUG = ZB + 1.55
for k, a in enumerate([rad(80), rad(170), rad(260), rad(350)]):
    rl = RJ + 0.17
    x, y = rl * math.cos(a), rl * math.sin(a)
    box(f"Pied{k}", (0.10, 0.10, Z_LUG), (x, y, Z_LUG / 2), MAT["structure"], rot_z=a, bevel=0.006)
    box(f"Platine{k}", (0.24, 0.24, 0.02), (x, y, 0.01), MAT["structure"], rot_z=a, bevel=0.003)
    for i in range(4):
        da = rad(45 + 90 * i)
        cyl(f"Cheville{k}_{i}", 0.012, 0.02, 0.04, MAT["poli"],
            (x + 0.08 * math.cos(a + da), y + 0.08 * math.sin(a + da)), seg=6)
    rc = RJ + 0.07
    box(f"Console{k}", (0.24, 0.16, 0.02), (rc * math.cos(a), rc * math.sin(a), Z_LUG + 0.01),
        MAT["inox"], rot_z=a, bevel=0.003)
    for s in (-1, 1):
        ox, oy = -math.sin(a) * 0.07 * s, math.cos(a) * 0.07 * s
        box(f"Gousset{k}_{s}", (0.20, 0.015, 0.20),
            (rc * math.cos(a) + ox, rc * math.sin(a) + oy, Z_LUG + 0.11),
            MAT["inox"], rot_z=a, bevel=0.003)

# --------------------------------------------------------------------------
# Bulles de gaz : couronne -> turbine Rushton -> projection radiale -> montée en spirale
# --------------------------------------------------------------------------
bub_mesh = None
bubbles = []
NBUB = 240
for i in range(NBUB):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    ob = link(f"Bulle{i:03d}", bm, MAT["bulle"], split=0)
    ob.visible_shadow = False
    bubbles.append(ob)

LIFE = 2.6 * FPS
OMEGA = 1.6  # rad/s, rotation du liquide


def bubble_state(seed, t):
    """Position (x, y, z) et taille d'une bulle à l'instant t (s) de son cycle."""
    rnd = random.Random(seed)
    a0 = rnd.uniform(0, TAU)
    size = rnd.uniform(0.007, 0.02)
    life = LIFE / FPS * rnd.uniform(0.85, 1.15)
    rwall = rnd.uniform(0.35, 0.68)
    wob = rnd.uniform(0, TAU)
    t1, t2 = 0.35 * life / 2.6, 0.55 * life / 2.6       # montée vers la turbine, projection
    if t < t1:                                           # sortie de la couronne
        u = t / t1
        r = R_SP + (0.20 - R_SP) * u
        z = Z_SPARGER + 0.02 + (Z_RUSHTON - Z_SPARGER - 0.02) * u
        a = a0 + OMEGA * t * 0.5
        s = size * 0.6
    elif t < t2:                                         # projection par la turbine
        u = (t - t1) / (t2 - t1)
        e = 1 - (1 - u) ** 2
        r = 0.20 + (rwall - 0.20) * e
        z = Z_RUSHTON + 0.05 * u + rnd.uniform(-0.03, 0.03)
        a = a0 + OMEGA * t1 * 0.5 + 3.0 * (t - t1)
        s = size * 0.8
    else:                                                # montée en spirale
        u = (t - t2) / (life - t2)
        r = rwall - 0.12 * u + 0.02 * math.sin(wob + 9 * u)
        z = Z_RUSHTON + 0.05 + (ZL - 0.02 - Z_RUSHTON - 0.05) * u
        a = a0 + OMEGA * t1 * 0.5 + 3.0 * (t2 - t1) + OMEGA * (t - t2)
        s = size * (1 + 0.4 * u)
    if t >= life:
        s = 0.0
    # éclat à la surface
    if t > life - 0.08:
        s *= max(0.0, (life - t) / 0.08)
    return (r * math.cos(a), r * math.sin(a), z), s, life


STEP = 2
for i, ob in enumerate(bubbles):
    seed = 1000 + i
    _, _, life = bubble_state(seed, 0)
    phase = (i / NBUB) * life
    for f in range(0, FRAMES + 3, STEP):
        t = (f / FPS + phase) % life
        cyc = int((f / FPS + phase) // life)
        p, s, _ = bubble_state(seed + 7919 * cyc, t)
        a = math.atan2(p[1], p[0])
        # masque doux à proximité du quart retiré
        da = min(abs((a - CUT_A0 + math.pi) % TAU - math.pi), abs((a - CUT_A1 + math.pi) % TAU - math.pi))
        if in_cut(a):
            s = 0.0
        elif da < 0.08:
            s *= da / 0.08
        ob.location = p
        ob.scale = (s, s, s * 0.85)
        ob.keyframe_insert("location", frame=f + 1)
        ob.keyframe_insert("scale", frame=f + 1)

# --------------------------------------------------------------------------
# Sol, monde, lumières
# --------------------------------------------------------------------------
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=30)
link("Sol", bm, MAT["sol"], smooth=False, split=0)

world = bpy.data.worlds.new("Atelier")
scene.world = world
world.use_nodes = True
wn = world.node_tree
bg = wn.nodes.get("Background")
grad_tc = wn.nodes.new("ShaderNodeTexCoord")
sep = wn.nodes.new("ShaderNodeSeparateXYZ")
ramp = wn.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position = 0.45
ramp.color_ramp.elements[0].color = (0.006, 0.007, 0.009, 1)
ramp.color_ramp.elements[1].position = 0.75
ramp.color_ramp.elements[1].color = (0.045, 0.05, 0.06, 1)
mr = wn.nodes.new("ShaderNodeMapRange")
mr.inputs["From Min"].default_value = -1
mr.inputs["From Max"].default_value = 1
wn.links.new(grad_tc.outputs["Generated"], sep.inputs[0])
wn.links.new(sep.outputs["Z"], mr.inputs["Value"])
wn.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
wn.links.new(ramp.outputs["Color"], bg.inputs["Color"])
bg.inputs["Strength"].default_value = 1.0


def area(name, size, loc, target, energy, color=(1, 1, 1), shape="RECTANGLE", cam_vis=False):
    ld = bpy.data.lights.new(name, "AREA")
    ld.shape = shape
    ld.size, ld.size_y = size
    ld.energy = energy
    ld.color = color
    ob = bpy.data.objects.new(name, ld)
    COL.objects.link(ob)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    ob.visible_camera = cam_vis
    return ob


area("Principale", (3.5, 3.5), (-1.2, -6.5, 6.0), (0, 0, 1.8), 2600, (1.0, 0.95, 0.88))
area("Débouchage", (4, 2.5), (6.5, -2.5, 3.0), (0, 0, 1.6), 650, (0.85, 0.92, 1.0))
area("Contre-jour", (4, 1.2), (-3.0, 5.5, 5.0), (0, 0, 2.2), 2400, (0.9, 0.95, 1.0))
area("Contre-jour 2", (3, 1.0), (4.0, 4.5, 4.0), (0, 0, 2.0), 1200, (1.0, 0.9, 0.8))
# bandes lumineuses : reflets verticaux sur l'inox
area("Bande A", (0.25, 4.0), (-3.2, -2.2, 2.4), (0, 0, 2.4), 500, cam_vis=False)
area("Bande B", (0.25, 4.0), (2.4, -3.6, 2.4), (0, 0, 2.4), 380, cam_vis=False)
area("Plafond", (6, 6), (0, 0, 7.5), (0, 0, 0), 450, (0.95, 0.97, 1.0))
# lampe de hublot : éclaire l'intérieur de la cuve
lamp = bpy.data.lights.new("Lampe hublot", "SPOT")
lamp.energy = 160
lamp.spot_size = rad(70)
lamp.shadow_soft_size = 0.05
lamp.color = (1.0, 0.86, 0.65)
lo = bpy.data.objects.new("Lampe hublot", lamp)
COL.objects.link(lo)
lo.location = (0.5 * math.cos(rad(105)), 0.5 * math.sin(rad(105)), Z1 - 0.05)
lo.rotation_euler = (Vector((0.1, -0.2, Z0)) - lo.location).to_track_quat("-Z", "Y").to_euler()
inner = bpy.data.lights.new("Ambiance cuve", "POINT")
inner.energy = 40
inner.shadow_soft_size = 0.3
inner.color = (0.7, 0.95, 1.0)
io = bpy.data.objects.new("Ambiance cuve", inner)
COL.objects.link(io)
io.location = (0.25 * math.cos(rad(120)), 0.25 * math.sin(rad(120)), Z_PBT + 0.2)

# --------------------------------------------------------------------------
# Caméra : orbite lente + travelling avant vers les turbines
# --------------------------------------------------------------------------
orbit = bpy.data.objects.new("Orbite", None)
COL.objects.link(orbit)
target = bpy.data.objects.new("Visée", None)
COL.objects.link(target)
cam_d = bpy.data.cameras.new("Caméra")
cam_d.lens = 30
cam_d.dof.use_dof = True
cam_d.dof.focus_object = target
cam_d.dof.aperture_fstop = 5.6
cam = bpy.data.objects.new("Caméra", cam_d)
COL.objects.link(cam)
cam.parent = orbit
scene.camera = cam
tc = cam.constraints.new("TRACK_TO")
tc.target = target
tc.track_axis = "TRACK_NEGATIVE_Z"
tc.up_axis = "UP_Y"

KEYS = [  # (frame, azimut°, distance, hauteur, visée z)
    (1, -74, 7.6, 2.8, 2.30),
    (FRAMES * 0.45, -58, 5.8, 2.4, 1.95),
    (FRAMES, -42, 3.3, 1.55, 1.35),
]
for f, az, d, h, tz in KEYS:
    f = int(round(f))
    orbit.rotation_euler = (0, 0, rad(az))
    orbit.keyframe_insert("rotation_euler", index=2, frame=f)
    cam.location = (d, 0, h)
    cam.keyframe_insert("location", frame=f)
    target.location = (0, 0, tz)
    target.keyframe_insert("location", frame=f)

# --------------------------------------------------------------------------
# Rendu
# --------------------------------------------------------------------------
r = scene.render
r.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 96
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = 0.02
scene.cycles.use_denoising = True
scene.cycles.denoiser = "OPENIMAGEDENOISE"
scene.cycles.max_bounces = 10
scene.cycles.diffuse_bounces = 3
scene.cycles.glossy_bounces = 4
scene.cycles.transmission_bounces = 10
scene.cycles.volume_bounces = 1
scene.cycles.transparent_max_bounces = 8
scene.cycles.caustics_reflective = False
scene.cycles.caustics_refractive = False
scene.cycles.blur_glossy = 1.0
r.use_motion_blur = True
r.motion_blur_shutter = 0.4
r.use_persistent_data = True
r.resolution_x, r.resolution_y = 1280, 720
r.resolution_percentage = 100
r.image_settings.file_format = "PNG"
r.film_transparent = False
scene.view_settings.view_transform = "AgX"
for look in ("AgX - Medium High Contrast", "Medium High Contrast"):
    try:
        scene.view_settings.look = look
        break
    except TypeError:
        pass

out = sys.argv[-1] if sys.argv[-1].endswith(".blend") else "reacteur.blend"
bpy.ops.wm.save_as_mainfile(filepath=out)
print("OK", out, len(bpy.data.objects), "objets")
