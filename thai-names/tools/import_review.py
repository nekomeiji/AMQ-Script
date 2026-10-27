"""Import hand-edited rows of the review table into thai_overrides.json.

Usage: python -I tools/import_review.py <review.md> [bundle.json] [thai_overrides.json]
Row format: | annId | AMQ name | Thai title in bundle | note |
A row counts as edited when its Thai title differs from the one in bundle.json. The edited title becomes the
override; the Thai names in the note become alt (the replaced bundle title is dropped). Existing overrides are kept.
"""
import json
import re
import sys

review_path = sys.argv[1]
bundle_path = sys.argv[2] if len(sys.argv) > 2 else "bundle.json"
overrides_path = sys.argv[3] if len(sys.argv) > 3 else "thai_overrides.json"

THAI = re.compile(r"[฀-๿]")
NOT_A_NAME = re.compile(r"^ชื่อไทยนี้ใช้กับ|ตัวอักษร$")

with open(bundle_path, encoding="utf-8") as f:
    current = {str(i[0]): i[3] for i in json.load(f)["items"]}
try:
    with open(overrides_path, encoding="utf-8") as f:
        overrides = json.load(f)
except FileNotFoundError:
    overrides = {}

edits = {}
malformed, warnings, conflicts = [], [], []
with open(review_path, encoding="utf-8") as f:
    for number, line in enumerate(f, 1):
        if not re.match(r"\|\s*\d+\s*\|", line):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 4:
            malformed.append(number)
            continue
        ann_id, _, th, note = cells
        if ann_id not in current:
            malformed.append(number)
            continue
        if th == current[ann_id]:
            continue
        if re.search(r"[<>]", th) or not th:
            warnings.append(f"line {number} ({ann_id}): skipped, empty or contains < >")
            continue
        if not THAI.search(th):
            warnings.append(f"line {number} ({ann_id}): no Thai script in {th!r} (applied anyway)")
        names = [n.strip() for n in note.split(";") if n.strip() and not NOT_A_NAME.search(n.strip())]
        if ann_id in edits and edits[ann_id]["th"] != th:
            conflicts.append(f"{ann_id}: {edits[ann_id]['th']!r} vs {th!r} (kept the first)")
            continue
        edits[ann_id] = {"th": th, "names": names}

for ann_id, e in edits.items():
    alt = list(overrides.get(ann_id, {}).get("alt", []))
    for name in e["names"]:
        if THAI.search(name) and name != e["th"] and name not in alt:
            alt.append(name)
    overrides[ann_id] = {"th": e["th"], "alt": alt}

with open(overrides_path, "w", encoding="utf-8") as f:
    json.dump(overrides, f, ensure_ascii=False, indent=2)
    f.write("\n")

print(f"edited anime: {len(edits)}, overrides total: {len(overrides)}")
for label, items in (("malformed rows (line numbers)", malformed), ("warnings", warnings), ("conflicts", conflicts)):
    if items:
        print(f"{label}: {len(items)}")
        for item in items[:10]:
            print("  ", item)
