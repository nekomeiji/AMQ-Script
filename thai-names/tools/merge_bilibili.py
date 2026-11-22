"""Match bilibili.tv series to AMQ anime and write thai_bilibili.json for build_bundle.py.

Usage: python -I tools/merge_bilibili.py [bilibili_pages.json] [thai_bilibili.json] [--dry]
A series matches an anime when its original (Japanese) title equals the AniList native / romaji / english title or the
AMQ jp / en name, ignoring season markers and punctuation.
  - One matching anime: it gets the Thai title.
  - Several anime whose AMQ names are the very same string (e.g. "Black Clover"): all get the same Thai title, season
    marker removed, because the game cannot tell them apart.
  - Several anime with different names: the one whose season equals the page's season; otherwise skipped.
Pages without Thai script in the title are ignored. "(พากย์ไทย)" / "(ซับไทย)" are removed. Thai-script aliases of the page
become alt names. For an anime with a hand-made override, a bilibili title that really differs is written with
"alt_only": build_bundle.py then adds it to the override's alt (the override stays the title). Season wording is turned into a bare number later by build_bundle.py.
"""
import collections
import json
import re
import sys
import unicodedata

args = [a for a in sys.argv[1:] if not a.startswith("--")]
pages_path = args[0] if len(args) > 0 else "bilibili_pages.json"
out_path = args[1] if len(args) > 1 else "thai_bilibili.json"
DRY = "--dry" in sys.argv

# season_of, MARKER_PAREN, MARKER_PLAIN, THAI and friends come from build_bundle.py (everything above its data loading)
exec(compile(open("tools/build_bundle.py", encoding="utf-8").read().split("\nnames = load(")[0], "build_bundle_helpers", "exec"))

pages = json.load(open(pages_path, encoding="utf-8"))
native = json.load(open("anilist_native.json", encoding="utf-8"))
names = json.load(open("anime_names.json", encoding="utf-8"))
bundle = {str(i[0]): i[3] for i in json.load(open("bundle.json", encoding="utf-8"))["items"]}
overrides = json.load(open("thai_overrides.json", encoding="utf-8"))

# dub / sub tags of any language, e.g. "(พากย์ไทย)", "(พากย์อินโดนีเซีย)", "(VN Dub)"
DUB = re.compile(r"\s*[(（][^()（）]*(?:พากย์|ซับ|\bdub\b|\bsub\b)[^()（）]*[)）]\s*", re.I)
LIVE_ACTION = re.compile(r"คนแสดง")  # live-action versions share the anime's original title but are another work


def clean_title(s):
    return re.sub(r"\s+", " ", DUB.sub(" ", ZERO_WIDTH.sub("", s or ""))).strip()
JP_SEASON = re.compile(r"(?:season|シーズン)\s*(\d+)|第?(\d+)期|(\d+)(?:st|nd|rd|th)\s*season|[①②③④⑤⑥⑦⑧⑨]", re.I)
CIRCLED = "①②③④⑤⑥⑦⑧⑨"


ALT_SKIP = {"10970", "15542", "19380"}  # bilibili's title is for another season / unusable ("ปี 5"), so it is not offered as an alt


def loose(s):
    """Title without spaces and punctuation/symbols (NFKC), to tell a real difference from a spacing one."""
    s = unicodedata.normalize("NFKC", s or "").lower()
    return "".join(c for c in s if unicodedata.category(c)[0] not in "PSZC")


def norm(s):
    s = unicodedata.normalize("NFKC", s or "").lower()
    s = re.sub(r"(season|シーズン)\s*\d+|第?\d+期|\d+(st|nd|rd|th)\s*season|\s(ii|iii|iv|\d|tv)$", " ", s)
    return re.sub(r"[\s\W_]+", "", s)


def page_season(page):
    """Season of a page from its Japanese title, or from the Thai one; None when nothing says which."""
    for text in (page["native"], page["th"]):
        n = season_of(text)
        if n:
            return n
    m = JP_SEASON.search(unicodedata.normalize("NFKC", page["native"] or ""))
    if m and (m.group(1) or m.group(2) or m.group(3)):
        return int(m.group(1) or m.group(2) or m.group(3))
    for ch in page["native"] or "":
        if ch in CIRCLED:
            return CIRCLED.index(ch) + 1
    m = MARKER_PAREN.search(page["th"] or "") or MARKER_PLAIN.search(page["th"] or "")  # "ภาคที่ 2", "ซีซั่น 3"
    return int(m.group(1)) if m else None


index = collections.defaultdict(set)
for ann_id, t in native.items():
    for field in ("native", "romaji", "english"):
        if t.get(field):
            index[norm(t[field])].add(ann_id)
for ann_id, n in names.items():
    for field in ("jp", "en"):
        if n.get(field):
            index[norm(n[field])].add(ann_id)


def amq_explicit_season(ann_id):
    n = names[ann_id]
    return season_of(n.get("jp")) or season_of(n.get("en"))


def amq_season(ann_id):
    return amq_explicit_season(ann_id) or 1


ZERO_WIDTH = re.compile("[​-‍﻿]")


proposals = collections.defaultdict(list)   # annId -> [(pageId, th, alt)]
stats = collections.Counter()
for page_id, page in pages.items():
    stats["pages"] += 1
    th = clean_title(page["th"])
    core = MARKER_PLAIN.sub("", MARKER_PAREN.sub("", th))  # "Yami Shibai ภาคที่ 6" has Thai script only in the season marker
    if not page["native"] or not THAI.search(core):
        stats["no native or no Thai title"] += 1
        continue
    if LIVE_ACTION.search(th):
        stats["live-action (skipped)"] += 1
        continue
    cands = sorted(index.get(norm(page["native"]), ()), key=int)
    if not cands:
        stats["no AMQ match"] += 1
        continue
    alt = [clean_title(a) for a in page["alias"] if THAI.search(a)]
    same_name = len({(names[a].get("jp"), names[a].get("en")) for a in cands}) == 1
    if len(cands) == 1:
        chosen = cands
    elif same_name:
        chosen = cands
        th = MARKER_PAREN.sub("", th).strip()
        th = MARKER_PLAIN.sub("", th).strip()
        alt = [MARKER_PLAIN.sub("", MARKER_PAREN.sub("", a)).strip() for a in alt]
    else:
        s = page_season(page)
        chosen = [a for a in cands if amq_season(a) == (s or 1)]
        if len(chosen) != 1:
            stats["ambiguous (skipped)"] += 1
            continue
    page_s = page_season(page)
    for a in chosen:
        if (len(cands) == 1 or not same_name) and page_s and amq_explicit_season(a) and page_s != amq_explicit_season(a):
            stats["season mismatch (skipped)"] += 1   # e.g. the page says season 1 but the AMQ name says Season 2
            continue
        proposals[a].append((page_id, th, [x for x in dict.fromkeys(alt) if x != th], page_season(page)))

result, outcome, shown = {}, collections.Counter(), collections.defaultdict(list)
for a, props in proposals.items():
    titles = {p[1] for p in props}
    if len(titles) > 1:
        # several pages reached the same anime (e.g. every season of a series): keep the page of the anime's own season
        props = [p for p in props if (p[3] or 1) == amq_season(a)]
        titles = {p[1] for p in props}
    if len(titles) != 1:
        outcome["two pages disagree (skipped)"] += 1
        shown["two pages disagree (skipped)"].append((a, sorted({p[1] for p in proposals[a]})))
        continue
    page_id, th, alt, _ = props[0]
    for p in props[1:]:
        alt += [x for x in p[2] if x not in alt]
    if a in overrides:
        kind = "same as override" if overrides[a].get("th") == th else "differs from override (override kept)"
    elif a not in bundle:
        kind = "new title"
    else:
        kind = "same as bundle" if bundle[a] == th else "replaces automatic title"
    outcome[kind] += 1
    shown[kind].append((a, bundle.get(a), th))
    if kind.startswith("differs from override"):
        # the override stays the title; the bilibili title becomes an extra searchable alt unless it only differs in spacing/punctuation
        mine = overrides[a].get("th")
        if mine and a not in ALT_SKIP and loose(mine) != loose(th) and th not in overrides[a].get("alt", []):
            result[a] = {"th": th, "alt": [], "src": page_id, "alt_only": True}
    elif not kind.startswith("same as override"):
        result[a] = {"th": th, "alt": alt, "src": page_id}

print("pages:", dict(stats))
print("anime reached:", len(proposals), dict(outcome))
for kind in ("new title", "replaces automatic title", "differs from override (override kept)", "two pages disagree (skipped)"):
    print(f"-- {kind}: {len(shown[kind])}")
    for item in shown[kind][:8]:
        a = item[0]
        print("  ", a, names[a].get("en") or names[a].get("jp"), "|", *item[1:])
if not DRY:
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    print("written", out_path, len(result))
