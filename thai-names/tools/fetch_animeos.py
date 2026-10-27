"""Fetch Thai series titles from anime-os.com /info/ pages and match them to AMQ anime by name.

Usage: python -I fetch_animeos.py [limit] [anime_names.json] [animeos_matches.json]
limit = number of pages to fetch (random sample, fixed seed); 0 = all.
Pages are cached under cache/animeos/ so re-runs only fetch missing pages.
/api/ is disallowed by the site's robots.txt and is never used.
"""
import html
import json
import os
import random
import re
import subprocess
import sys
import time
import unicodedata

limit = int(sys.argv[1]) if len(sys.argv) > 1 else 20
names_path = sys.argv[2] if len(sys.argv) > 2 else "anime_names.json"
out_path = sys.argv[3] if len(sys.argv) > 3 else "animeos_matches.json"

BASE = "https://www.anime-os.com"
CACHE = os.path.join("cache", "animeos")
DELAY = 1.0
os.makedirs(CACHE, exist_ok=True)


def curl(url):
    # curl.exe uses the Windows certificate store; Python 3.10's bundled OpenSSL rejects some chains.
    return subprocess.run(["curl.exe", "-sS", "--fail", "--max-time", "60", url],
                          capture_output=True, check=True).stdout.decode("utf-8")


def norm(s):
    s = unicodedata.normalize("NFKD", s).lower()
    return re.sub(r"[^a-z0-9]+", "", s)


sitemap = curl(BASE + "/sitemap.xml")
slugs = re.findall(r"<loc>https://www\.anime-os\.com/info/([^<]+)</loc>", sitemap)
print(f"sitemap /info/ pages: {len(slugs)}")
if limit:
    random.Random(1).shuffle(slugs)
    slugs = slugs[:limit]

pages = {}
for slug in slugs:
    path = os.path.join(CACHE, slug + ".html")
    if not os.path.exists(path):
        try:
            page = curl(f"{BASE}/info/{slug}")
        except subprocess.CalledProcessError as e:
            print(f"skip {slug}: {e.stderr.decode('utf-8', 'replace').strip()}")
            continue
        with open(path, "w", encoding="utf-8") as f:
            f.write(page)
        time.sleep(DELAY)
    with open(path, encoding="utf-8") as f:
        pages[slug] = f.read()

THAI = re.compile(r"[฀-๿]")
SEASON_WORDS = re.compile(
    r"\b(?:\d+(?:st|nd|rd|th)\s+season|season\s*\d+(?:\s*-\s*\d+)?|(?:\d+(?:st|nd|rd|th)\s+)?cour\s*\d*|part\s*\d+)\b"
    r"|\s(?:ii|iii|iv)$")


def norm_relaxed(s):
    """Like norm, but ignores season/cour wording, parentheses and the wo/o spelling difference."""
    s = re.sub(r"\([^)]*\)", " ", s.lower())
    s = SEASON_WORDS.sub(" ", s)
    s = re.sub(r"\bwo\b", "o", s)
    return norm(s)


def series_stem(s):
    """First two words of a title (one if it has only one), used to tell which entries share a series."""
    words = re.findall(r"[a-z0-9]+", re.sub(r"\([^)]*\)", " ", s.lower()))
    return tuple(words[:2])


exact_index, relaxed_index = {}, {}
with open(names_path, encoding="utf-8") as f:
    for ann_id, n in json.load(f).items():
        for key in (n.get("jp"), n.get("en")):
            if key:
                exact_index.setdefault(norm(key), set()).add(ann_id)
                relaxed_index.setdefault(norm_relaxed(key), set()).add(ann_id)

result = {}
total_entries = matched_exact = matched_relaxed = 0
for slug, page in pages.items():
    m = re.search(r"<h1[^>]*>(.*?)</h1>", page, re.S)
    if not m:
        continue
    h1 = html.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip()
    entries = []
    for h3 in re.findall(r"<h3[^>]*>(.*?)</h3>", page, re.S):
        text = html.unescape(re.sub(r"<[^>]+>", "", h3)).strip()
        text = re.sub(r"\s*\(\d{4}\)\s*$", "", text)
        if re.search(r"[A-Za-z]", text):
            entries.append(text)
    # Single-entry pages have no season list: the h1 is "<romaji> <Thai>" or only the romaji.
    first_thai = THAI.search(h1)
    paren = re.match(r"^(.*?)\s*[(（](.*[฀-๿].*)[)）]\s*$", h1)
    if paren and paren.group(1).strip() and not THAI.search(paren.group(1)):
        latin, th = paren.group(1).strip(), paren.group(2).strip()
        entries.append(latin)
    elif first_thai and first_thai.start() > 0:
        latin, th = h1[:first_thai.start()].strip(" (（"), h1[first_thai.start():].strip()
        if latin:
            entries.append(latin)
    else:
        th = h1 if first_thai else ""
    while th.endswith(")") and th.count(")") > th.count("("):
        th = th[:-1].rstrip()
    if not th or th.startswith("และ"):
        continue  # no Thai title, or a multi-series page whose heading is not a title
    # The Thai title belongs to the first entry's series; other series listed on the page must not inherit it.
    stem = series_stem(entries[0]) if entries else None
    ids = set()
    for text in entries:
        if series_stem(text) != stem:
            continue
        total_entries += 1
        hit = exact_index.get(norm(text))
        if hit:
            matched_exact += 1
        else:
            hit = relaxed_index.get(norm_relaxed(text))
            if hit:
                matched_relaxed += 1
        ids |= hit or set()
    result[slug] = {"th": th, "entries": entries, "ann_ids": sorted(ids, key=int)}

with open(out_path, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=1)

pages_matched = sum(1 for r in result.values() if r["ann_ids"])
print(f"pages with a Thai title: {len(result)}, with at least one AMQ match: {pages_matched}")
print(f"entries: {total_entries}, matched exactly: {matched_exact}, matched after relaxing season wording: {matched_relaxed}")
print(f"AMQ annIds reached: {len({a for r in result.values() for a in r['ann_ids']})}")
