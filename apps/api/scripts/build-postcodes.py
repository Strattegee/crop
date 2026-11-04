#!/usr/bin/env python3
"""Builds CROP's postcode location files from the GeoNames postal code downloads (CC BY 4.0).

Postal code data (c) GeoNames, https://www.geonames.org/, licensed under CC BY 4.0. See apps/api/data/geo/NOTICE.

Usage (from the repository root; GEONAMES holds AU/AU.txt, NZ/NZ.txt, US/US.txt, GB/GB.txt as downloaded and unzipped
from https://download.geonames.org/export/zip/):

    python3 -I apps/api/scripts/build-postcodes.py GEONAMES

Writes apps/api/data/geo/postcodes-<cc>.tsv: one line per postcode, "postcode<TAB>lat<TAB>lon", the average of the
GeoNames rows sharing that postcode, rounded to 3 decimals (about 100 m), sorted by postcode. Postcodes are tidied the
way CROP stores them (upper case; UK with one space). US keeps the 5-digit ZIP. The UK file (GB.txt) has outward codes
only ("LS1"); if the full file (GB_full.txt, codes like "LS1 1UR") is given instead, full codes are kept and each
outward code also gets the average of its full codes, so lookups can fall back to it.

The downloads are read as plain text only; nothing in them is run.
"""
import os
import re
import sys

COUNTRIES = ('AU', 'NZ', 'US', 'GB')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'geo')
VALID = {
    'AU': re.compile(r'^\d{4}$'),
    'NZ': re.compile(r'^\d{4}$'),
    'US': re.compile(r'^\d{5}$'),
    'GB': re.compile(r'^[A-Z]{1,2}\d[A-Z\d]?( \d[A-Z]{2})?$'),
}


def tidy(country, code):
    s = code.strip().upper()
    if country == 'GB':
        s = re.sub(r'\s+', '', s)
        m = re.match(r'^(.+)(\d[A-Z]{2})$', s)
        # Outward codes alone ("LS1", "M9", "DN14") stay as they are; a full code gets its one space.
        if m and len(s) >= 5:
            s = f'{m.group(1)} {m.group(2)}'
    if country == 'US':
        s = s[:5]
    return s


def build(country, path):
    sums = {}
    with open(path, encoding='utf-8') as f:
        for line in f:
            cols = line.rstrip('\n').split('\t')
            if len(cols) < 11 or cols[0] != country:
                continue
            try:
                lat, lon = float(cols[9]), float(cols[10])
            except ValueError:
                continue
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                continue
            code = tidy(country, cols[1])
            if not VALID[country].match(code):
                continue
            keys = [code]
            if country == 'GB' and ' ' in code:
                keys.append(code.split(' ')[0])
            for k in keys:
                s = sums.setdefault(k, [0.0, 0.0, 0])
                s[0] += lat
                s[1] += lon
                s[2] += 1
    rows = []
    for code in sorted(sums):
        lat, lon, n = sums[code]
        rows.append(f'{code}\t{round(lat / n, 3):g}\t{round(lon / n, 3):g}\n')
    return rows


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    for c in COUNTRIES:
        path = os.path.join(src, c, f'{c}.txt')
        full = os.path.join(src, c, f'{c}_full.txt')
        if c == 'GB' and os.path.exists(full):
            path = full
        if not os.path.exists(path):
            print(f'{c}: no {path}, skipped')
            continue
        rows = build(c, path)
        out = os.path.join(OUT, f'postcodes-{c.lower()}.tsv')
        with open(out, 'w', encoding='utf-8', newline='\n') as f:
            f.writelines(rows)
        print(f'{c}: {len(rows)} postcodes, {os.path.getsize(out)} bytes -> {os.path.relpath(out)}')


if __name__ == '__main__':
    main()
