"""Build the self-contained index.html: inlines the WebP photos of assets/ as data URIs.

Usage: python3 build.py            -> index.html (repo version)
       python3 build.py artifact   -> prints the artifact variant path (no doctype/html/head/body wrapper)
"""
import base64, json, pathlib, sys

HERE = pathlib.Path(__file__).parent
KEYS = ["mountain", "eagle", "tiger_rock", "tiger_leap", "tiger_under", "splash", "whale"]
CREDITS = [
    dict(subject="Montagnes du Pirin (Vihren et Kutelo)", author="kallerna", license="CC BY-SA 4.0",
         page="https://commons.wikimedia.org/wiki/File:Vihren_%26_Kutelo_Pirin_Mountains_Bulgaria_2025.jpg"),
    dict(subject="Aigle royal en vol", author="USFWS Mountain-Prairie", license="Domaine public",
         page="https://commons.wikimedia.org/wiki/File:Golden_Eagle_on_Seedskadee_NWR_(23661557775).jpg"),
    dict(subject="Tigre sur le rocher (Mike VII)", author="Boyd Crochet", license="CC BY-SA 4.0",
         page="https://commons.wikimedia.org/wiki/File:Mike_VII.jpg"),
    dict(subject="Tigre en plein bond", author="Davidvraju", license="CC BY-SA 4.0",
         page="https://commons.wikimedia.org/wiki/File:Tiger_jumping_David_RaJU.jpg"),
    dict(subject="Tigre blanc du Bengale sous l’eau (Odin)", author="Jerry", license="CC BY 2.0",
         page="https://commons.wikimedia.org/wiki/File:Odin_the_White_Bengal_Tiger_-_So_Close_(2758672555).jpg"),
    dict(subject="Gerbe d’une baleine à bosse", author="Giles Laurent", license="CC BY-SA 4.0",
         page="https://commons.wikimedia.org/wiki/File:026e_Humpback_whale_jump_and_splash_Photo_by_Giles_Laurent.jpg"),
    dict(subject="Baleine à bosse en saut", author="Wanetta Ayers", license="Domaine public",
         page="https://commons.wikimedia.org/wiki/File:HumpbackWhaleBreaching.jpg"),
]

def build(out: pathlib.Path, artifact: bool):
    images = {k: "data:image/webp;base64," + base64.b64encode((HERE / "assets" / f"{k}.webp").read_bytes()).decode() for k in KEYS}
    payload = json.dumps({"images": images, "credits": CREDITS}, ensure_ascii=False).replace("</", "<\\/")
    html = (HERE / "template.html").read_text(encoding="utf-8").replace("/*__ASSETS__*/", payload)
    if artifact:  # the artifact host wraps the page in its own skeleton
        for tag in ['<!DOCTYPE html>\n', '<html lang="fr">\n', '<head>\n', '<meta charset="utf-8">\n',
                    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n',
                    '</head>\n', '<body>\n', '</body>\n', '</html>\n']:
            assert html.count(tag) == 1, tag
            html = html.replace(tag, "")
    if artifact:
        html = html.replace("  if (location.hash === '#debug') window.__film = { tl, ST, SHOTS };   // test hook\n", "")
    out.write_text(html, encoding="utf-8")
    print(out, f"{out.stat().st_size / 1e6:.2f} MB")

if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "artifact":
        build(pathlib.Path(sys.argv[2]), True)
    else:
        build(HERE / "index.html", False)
