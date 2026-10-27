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

index = {}
with open(names_path, encoding="utf-8") as f:
    for ann_id, n in json.load(f).items():
        for key in (n.get("jp"), n.get("en")):
            if key:
                index.setdefault(norm(key), set()).add(ann_id)

result = {}
total_entries = matched_entries = 0
for slug, page in pages.items():
    m = re.search(r"<h1[^>]*>(.*?)</h1>", page, re.S)
    if not m:
        continue
    th = html.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip()
    entries = []
    for h3 in re.findall(r"<h3[^>]*>(.*?)</h3>", page, re.S):
        text = html.unescape(re.sub(r"<[^>]+>", "", h3)).strip()
        text = re.sub(r"\s*\(\d{4}\)\s*$", "", text)
        if re.search(r"[A-Za-z]", text):
            entries.append(text)
    ids = set()
    for text in entries:
        total_entries += 1
        hit = index.get(norm(text))
        if hit:
            matched_entries += 1
            ids |= hit
    result[slug] = {"th": th, "entries": entries, "ann_ids": sorted(ids, key=int)}

with open(out_path, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=1)

pages_matched = sum(1 for r in result.values() if r["ann_ids"])
print(f"pages parsed: {len(result)}, with at least one AMQ match: {pages_matched}")
print(f"season entries: {total_entries}, matched by name: {matched_entries}")
print(f"AMQ annIds reached: {len({a for r in result.values() for a in r['ann_ids']})}")
