"""Export anime names + external ids from the AMQ sqlite into anime_names.json.

Usage: python -I export_names.py <songs.sqlite3> [out.json]
Keyed by annId so later steps (Thai lookup, userscript) can diff on new ids.
"""
import json
import sqlite3
import sys

db_path = sys.argv[1]
out_path = sys.argv[2] if len(sys.argv) > 2 else "anime_names.json"

con = sqlite3.connect("file:" + db_path.replace("\\", "/") + "?mode=ro", uri=True)

# animedata holds every anime; Songs carries the MAL/AniList/Kitsu ids per annId.
ids = {}
for ann_id, mal, ani, kitsu in con.execute(
    "SELECT annid, MAX(malId), MAX(aniListId), MAX(kitsuId) FROM Songs GROUP BY annid"
):
    ids[ann_id] = (mal, ani, kitsu)

names = {}
# Songs also holds anime added after the last animedata import; animedata wins when both exist.
for ann_id, jp, en in con.execute("SELECT annid, MAX(anime), MAX(animeEnglish) FROM Songs GROUP BY annid"):
    names[ann_id] = (jp, en)
for ann_id, jp, en in con.execute("SELECT annId, nameJP, nameEN FROM animedata"):
    names[ann_id] = (jp, en)

result = {}
for ann_id in sorted(names):
    jp, en = names[ann_id]
    mal, ani, kitsu = ids.get(ann_id, (None, None, None))
    entry = {"jp": jp, "en": en}
    if mal:
        entry["mal"] = mal
    if ani:
        entry["al"] = ani
    if kitsu:
        entry["kitsu"] = kitsu
    result[str(ann_id)] = entry

with open(out_path, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, separators=(",", ":"))

print(f"{len(result)} anime, {sum('mal' in e for e in result.values())} with MAL id -> {out_path}")
