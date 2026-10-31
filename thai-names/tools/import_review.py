"""Import hand-edited rows of a review table into thai_overrides.json.

Usage: python -I tools/import_review.py <review.md> [bundle.json] [thai_overrides.json]
Row formats:  | annId | AMQ name | Thai title | note |            (risk review, 4 columns)
              | annId | type | JP | EN | Thai title |             (series review, 5 columns)
In the 5-column format the Thai title cell may be "main title ; alt name ; alt name": the first is the title, the others become alt.
A row counts as edited when its Thai title differs from the one in bundle.json. The edited title becomes the
override; Thai names in the note (4-column format) become alt. A row whose title was replaced by the "ไม่มี"
marker is an explicit "no Thai title" (override with an empty th). Existing overrides are kept.
"""
import json
import re
import sys

review_path = sys.argv[1]
bundle_path = sys.argv[2] if len(sys.argv) > 2 else "bundle.json"
overrides_path = sys.argv[3] if len(sys.argv) > 3 else "thai_overrides.json"

THAI = re.compile(r"[฀-๿]")
NOT_A_NAME = re.compile(r"^ชื่อไทยนี้ใช้กับ|ตัวอักษร$")
# Spelling the user settled on (same list as build_bundle.py).
SPELLING = [("เฟท/สเตย์ ไนท์", "เฟต/สเตย์ไนท์"), ("เฟท/สเตย์ไนท์", "เฟต/สเตย์ไนท์"),
            ("เฟต/สเตย์ ไนท์", "เฟต/สเตย์ไนท์"), ("เฟต/สเตย์ไนต์", "เฟต/สเตย์ไนท์"),
            ("สงครามเกมไพ่", "ดูเอลมาสเตอร์")]

with open(bundle_path, encoding="utf-8") as f:
    items = json.load(f)["items"]
current = {str(i[0]): i[3] for i in items}
current_alt = {str(i[0]): i[4] for i in items}
edits_alt_only = set()
try:
    with open(overrides_path, encoding="utf-8") as f:
        overrides = json.load(f)
except FileNotFoundError:
    overrides = {}


def clean(th):
    for old, new in SPELLING:
        th = th.replace(old, new)
    if th.startswith('"') and th.count('"') % 2 == 1:
        th = th[1:]  # stray opening quote
    if th.endswith('"') and th.count('"') % 2 == 1:
        th = th[:-1]
    return th.strip()


edits = {}
deletions = set()
malformed, warnings, conflicts = [], [], []
with open(review_path, encoding="utf-8") as f:
    for number, line in enumerate(f, 1):
        if not re.match(r"\|\s*\d+\s*\|", line):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) == 4:
            ann_id, _, th, note = cells
        elif len(cells) == 5:
            ann_id, _, _, _, th = cells
            th, _, note = th.partition(";")  # "main ; alt ; alt": the first name is the title, the rest become alt
            th = th.strip()
        else:
            malformed.append(number)
            continue
        if "ไม่มี" in th and "**" in th:
            if ann_id in current:
                deletions.add(ann_id)
            continue
        th = clean(th)
        names = [clean(n) for n in note.split(";") if n.strip() and not NOT_A_NAME.search(n.strip())]
        if th == current.get(ann_id):
            # same title: still an edit when the row lists alt names the bundle does not have yet
            if not [n for n in names if THAI.search(n) and n != th and n not in current_alt.get(ann_id, [])]:
                continue
            edits_alt_only.add(ann_id)
        if re.search(r"[<>]", th) or not th:
            warnings.append(f"line {number} ({ann_id}): skipped, empty or contains < >")
            continue
        if not THAI.search(th):
            warnings.append(f"line {number} ({ann_id}): no Thai script in {th!r} (applied anyway)")
        if ann_id in edits and edits[ann_id]["th"] != th:
            conflicts.append(f"{ann_id}: {edits[ann_id]['th']!r} vs {th!r} (kept the first)")
            continue
        edits[ann_id] = {"th": th, "names": names}

for ann_id, e in edits.items():
    # an alt-only edit keeps the alt names the bundle already has for that anime
    alt = list(overrides.get(ann_id, {}).get("alt", current_alt.get(ann_id, []) if ann_id in edits_alt_only else []))
    for name in e["names"]:
        if THAI.search(name) and name != e["th"] and name not in alt:
            alt.append(name)
    overrides[ann_id] = {"th": e["th"], "alt": alt}
for ann_id in sorted(deletions - set(edits), key=int):
    overrides[ann_id] = {"th": "", "alt": []}

with open(overrides_path, "w", encoding="utf-8") as f:
    json.dump(overrides, f, ensure_ascii=False, indent=2)
    f.write("\n")

print(f"edited anime: {len(edits)}, removed titles: {len(deletions - set(edits))}, overrides total: {len(overrides)}")
if deletions - set(edits):
    print("  removed:", ", ".join(sorted(deletions - set(edits), key=int)))
for label, items in (("malformed rows (line numbers)", malformed), ("warnings", warnings), ("conflicts", conflicts)):
    if items:
        print(f"{label}: {len(items)}")
        for item in items[:10]:
            print("  ", item)
