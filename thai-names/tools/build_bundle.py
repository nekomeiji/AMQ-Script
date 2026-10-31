"""Merge Thai titles from all sources into bundle.json for the userscript.

Usage: python -I build_bundle.py
Priority per annId: thai_overrides.json > Wikidata > AniList > anime-os. Other distinct Thai titles go to alt.
Season rule: the Thai title ends with the bare season number (" N", nothing for season 1) instead of words like
ภาค / ซีซั่น; the original wording stays in alt. N comes from the AMQ jp/en name, or from an explicit trailing
marker in the Thai title when AMQ has none.
Overrides are used verbatim.
"""
import datetime
import json
import os
import re

THAI = re.compile(r"[฀-๿]")
ROMAN = {"II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10}


def load(path, default):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


UNICODE_ROMAN = {"Ⅰ": "I", "Ⅱ": "II", "Ⅲ": "III", "Ⅳ": "IV", "Ⅴ": "V", "Ⅵ": "VI",
                 "Ⅶ": "VII", "Ⅷ": "VIII", "Ⅸ": "IX", "Ⅹ": "X"}
# Spelling the user settled on; applied to source titles (overrides are used verbatim). Same list in import_review.py.
SPELLING = [("เฟท/สเตย์ ไนท์", "เฟต/สเตย์ไนท์"), ("เฟท/สเตย์ไนท์", "เฟต/สเตย์ไนท์"),
            ("เฟต/สเตย์ ไนท์", "เฟต/สเตย์ไนท์"), ("เฟต/สเตย์ไนต์", "เฟต/สเตย์ไนท์")]


def ascii_roman(s):
    """Single-character Roman numerals (Ⅱ) become plain letters (II) so the season rules can see them."""
    return "".join(UNICODE_ROMAN.get(c, c) for c in s)


def respell(s):
    for old, new in SPELLING:
        s = s.replace(old, new)
    return s


def season_of(name):
    if not name:
        return None
    name = ascii_roman(name)
    m = (re.search(r"\b(\d+)(?:st|nd|rd|th) season\b", name, re.I)
         or re.search(r"\bseason (\d+)\b", name, re.I)
         or re.search(r"\s(II|III|IV)$", name)
         or re.search(r"\s([2-9])$", name))
    if not m:
        return None
    g = m.group(1)
    return ROMAN.get(g) or int(g)


WORDS = r"(?:ภาคที่|ภาค|ซีซั่นที่|ซีซันที่|ซีซั่น|ซีซัน|ฤดูกาลที่|ฤดูกาล|season)"
LATIN_TAIL = re.compile(r"^(.*[฀-๿])\s*([(（]?)\s*([A-Za-z][A-Za-z0-9 '’:\-!?.&,/]*?)\s*[)）]?\s*$")


def name_key(s):
    s = re.sub(r"\([^)]*\)", " ", (s or "").lower())
    s = re.sub(r"\b(?:\d+(?:st|nd|rd|th)\s+season|season\s*\d+(?:\s*-\s*\d+)?|part\s*\d+|cour\s*\d*)\b|\s(?:ii|iii|iv)$", " ", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def strip_latin_tail(th, n):
    """Drop a trailing Latin phrase (2+ words, or in parentheses) that just repeats the anime's jp/en name.

    A single trailing word (e.g. "ยอดผู้กล้า Helck") is part of the title and stays, as does Latin inside the title.
    """
    m = LATIN_TAIL.match(th)
    if not m:
        return th
    if not m.group(2) and len(m.group(3).split()) < 2:
        return th
    key = name_key(m.group(3))
    known = {name_key(n.get("jp")), name_key(n.get("en"))} - {""}
    if key and any(k == key or (len(key) >= 7 and k.startswith(key)) for k in known):
        return m.group(1).rstrip()
    return th


EPISODE_LIST = re.compile(r"^\s*รายชื่อตอน(?:ใน)?\s*")
MARKER_PAREN = re.compile(rf"\s*[(（]\s*{WORDS}\s*(\d+)\s*[)）]\s*$", re.I)
MARKER_PLAIN = re.compile(rf"\s*{WORDS}\s*(\d+)\s*$", re.I)


def strip_marker(th):
    """For titles whose AMQ name has no season: an explicit trailing marker still becomes a bare number."""
    m = MARKER_PAREN.search(th) or MARKER_PLAIN.search(th)
    if not m:
        return th
    base, found = th[:m.start()].rstrip(), int(m.group(1))
    return base if found == 1 else f"{base} {found}"


def normalize_season(th, n):
    """Show the season as a bare trailing number (nothing for season 1); leave th alone if it disagrees with n."""
    m = MARKER_PAREN.search(th) or MARKER_PLAIN.search(th)
    if m:
        base, found = th[:m.start()].rstrip(), int(m.group(1))
    else:
        r = re.search(r"\s(II|III|IV)$", th)
        if r and ROMAN[r.group(1)] == n:
            base, found = th[:r.start()].rstrip(), n
        elif re.search(rf"{WORDS}\s*\d+", th, re.I):
            return th  # season wording in the middle of the title (e.g. "ภาค 2 OVA"): leave it
        else:
            tail = re.search(r"(?<!\d)(\d+)\s*$", th)
            if tail and int(tail.group(1)) == n:
                return th
            base, found = th, n
    if found != n:
        return th
    return base if n == 1 else f"{base} {n}"


names = load("anime_names.json", {})
wikidata = load("thai_names.json", {})
anilist = load("anilist_thai.json", {})
animeos = load("animeos_matches.json", {})
overrides = load("thai_overrides.json", {})

# String-keyed overrides exported from the userscript: resolve to an annId when the string is a jp/en name,
# otherwise (alt names) keep them as name_overrides so they still work in the dropdown.
name_overrides = load("thai_name_overrides.json", {})
by_norm = {}
for ann_id, n in names.items():
    for key in (n.get("jp"), n.get("en")):
        if key:
            by_norm.setdefault(re.sub(r"[^a-z0-9]+", "", key.lower()), set()).add(ann_id)
unresolved = {}
for text, th in name_overrides.items():
    hit = by_norm.get(re.sub(r"[^a-z0-9]+", "", text.lower()))
    if hit:
        for ann_id in hit:
            overrides.setdefault(ann_id, {"th": th})
    else:
        unresolved[text] = th

def series_stem(s):
    words = re.findall(r"[a-z0-9]+", re.sub(r"\([^)]*\)", " ", (s or "").lower()))
    return tuple(words[:2])


# An anime reached by pages with different Thai titles is ambiguous: keep the page whose first entry shares the
# AMQ name's series stem, otherwise drop anime-os for it (no title is better than a wrong one).
animeos_pages = {}
for page in animeos.values():
    if THAI.search(page["th"]):
        for ann_id in page["ann_ids"]:
            animeos_pages.setdefault(ann_id, []).append(page)
animeos_by_ann = {}
for ann_id, pages in animeos_pages.items():
    titles = {p["th"] for p in pages}
    if len(titles) == 1:
        animeos_by_ann[ann_id] = pages[0]["th"]
        continue
    stems = {series_stem(names[ann_id].get("jp")), series_stem(names[ann_id].get("en"))}
    good = {p["th"] for p in pages if p["entries"] and series_stem(p["entries"][0]) in stems}
    if len(good) == 1:
        animeos_by_ann[ann_id] = good.pop()

MOVIE = re.compile(r"\b(?:movie|film|motion picture|gekijouban)\b", re.I)
items = []
changed = []
skipped_movie = []
for ann_id, n in names.items():
    ov = overrides.get(ann_id)
    if ov is not None and ov.get("th") == "":
        continue  # explicit "no Thai title" (override with an empty th)
    if ov and ov.get("th"):
        th, alt = ov["th"], list(ov.get("alt", []))
    else:
        cands = []
        wd = wikidata.get(ann_id, {})
        if wd.get("th") and THAI.search(wd["th"]):
            amq_text = f"{n.get('jp') or ''} {n.get('en') or ''}"
            if MOVIE.search(wd.get("en", "")) and not MOVIE.search(amq_text):
                # Either the id points at the movie (wrong title) or the AMQ name just omits "movie": report only.
                skipped_movie.append((ann_id, n.get("en") or n.get("jp"), wd["en"]))
            cands += [wd["th"]] + wd.get("alt", [])
        cands += anilist.get(ann_id, [])
        if ann_id in animeos_by_ann:
            cands.append(animeos_by_ann[ann_id])
        cands = [respell(ascii_roman(strip_latin_tail(EPISODE_LIST.sub("", c).strip(), n))) for c in cands]  # some Wikidata items are episode-list pages
        cands = list(dict.fromkeys(c for c in cands if c))
        if not cands:
            continue
        th, alt = cands[0], cands[1:]
        season = season_of(n.get("jp")) or season_of(n.get("en"))
        new = normalize_season(th, season) if season else strip_marker(th)
        if new != th:
            if not new.startswith(th):
                alt = [th] + alt  # keep the original wording searchable
            changed.append((n.get("en") or n.get("jp"), th, new))
            th = new
    items.append([int(ann_id), n.get("jp") or "", n.get("en") or "", th, alt])

# jp/en pairs of every anime, only used by the userscript to sort the editor table by the jp name
pairs = [[n.get("jp") or "", n.get("en") or ""] for n in names.values() if n.get("jp") or n.get("en")]

bundle = {"v": int(datetime.datetime.now().strftime("%Y%m%d%H%M")), "items": items, "name_overrides": unresolved, "pairs": pairs}
with open("bundle.json", "w", encoding="utf-8") as f:
    json.dump(bundle, f, ensure_ascii=False, separators=(",", ":"))

print(f"bundle: {len(items)} of {len(names)} anime have a Thai title, season wording changed on {len(changed)}")
for en, old, new in changed[:15]:
    print(f"  {en} | {old} -> {new}")
print(f"Check: Wikidata says movie but the AMQ name does not (kept): {len(skipped_movie)}")
for ann_id, amq_name, wd_en in skipped_movie:
    print(f"  {ann_id} | AMQ: {amq_name} | Wikidata: {wd_en}")
print(f"name overrides kept by string (no annId match): {len(unresolved)}")
print(f"size: {os.path.getsize('bundle.json') / 1024:.0f} KB")
