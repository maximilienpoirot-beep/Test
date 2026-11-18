"""Choisit les altcoins du test : 12 premières paires USDT par volume (USDT) de janvier 2020,
paires retirées comprises (liste lue dans les archives data.binance.vision)."""
import csv, io, re, zipfile
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import urlopen

S3 = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
ARCH = "https://data.binance.vision/data/spot/monthly/klines"
EXCLUS = {"BTC", "ETH", "USDC", "TUSD", "PAX", "USDP", "BUSD", "USDS", "USDSB", "DAI", "EUR",
          "GBP", "AUD", "TRY", "BRL", "RUB", "NGN", "UAH", "BIDR", "IDRT", "BKRW", "FDUSD", "UST"}


def symboles():
    out, marque = [], ""
    while True:
        q = urlencode({"delimiter": "/", "prefix": "data/spot/monthly/klines/", "marker": marque})
        xml = urlopen(f"{S3}?{q}", timeout=30).read().decode()
        out += re.findall(r"<Prefix>data/spot/monthly/klines/([A-Z0-9]+)/</Prefix>", xml)
        if "<IsTruncated>true</IsTruncated>" not in xml:
            return out
        marque = re.search(r"<NextMarker>(.*?)</NextMarker>", xml).group(1)


def volume_janv_2020(sym):
    try:
        z = urlopen(f"{ARCH}/{sym}/1d/{sym}-1d-2020-01.zip", timeout=30).read()
    except HTTPError:
        return sym, None
    with zipfile.ZipFile(io.BytesIO(z)) as f:
        lignes = list(csv.reader(io.TextIOWrapper(f.open(f.namelist()[0]))))
    return sym, sum(float(l[7]) for l in lignes)


if __name__ == "__main__":
    tous = symboles()
    usdt = [s for s in tous if s.endswith("USDT")]
    base = lambda s: s[:-4]
    cand = [s for s in usdt if base(s) not in EXCLUS
            and not re.search(r"(UP|DOWN|BULL|BEAR)$", base(s))]
    print(f"{len(tous)} symboles, {len(usdt)} en USDT, {len(cand)} candidats")
    with ThreadPoolExecutor(16) as ex:
        vols = [v for v in ex.map(volume_janv_2020, cand) if v[1]]
    vols.sort(key=lambda v: -v[1])
    print(f"{len(vols)} paires cotées en janvier 2020. Top 20 (volume janv. 2020, M USDT) :")
    for i, (s, v) in enumerate(vols[:20], 1):
        print(f"{i:3d} {s:10s} {v/1e6:9.0f}")
    with open("donnees/univers_altcoins.txt", "w") as f:
        f.write("\n".join(s for s, _ in vols[:12]) + "\n")
