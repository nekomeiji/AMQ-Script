"""Look for Thai titles in AniList synonyms for AMQ anime that have an AniList or MAL id.

Usage: python -I fetch_anilist.py [anime_names.json] [anilist_thai.json]
AniList has no Thai title field, so this only keeps synonyms containing Thai script.
Uses the public GraphQL API at <= 1 request/second (limit is 90/min).
"""
import json
import re
import subprocess
import sys
import time

names_path = sys.argv[1] if len(sys.argv) > 1 else "anime_names.json"
out_path = sys.argv[2] if len(sys.argv) > 2 else "anilist_thai.json"

URL = "https://graphql.anilist.co"
PAGE = 50
THAI = re.compile(r"[฀-๿]")

QUERY_BY_ID = "query($ids:[Int]){Page(perPage:50){media(id_in:$ids,type:ANIME){id idMal synonyms}}}"
QUERY_BY_MAL = "query($ids:[Int]){Page(perPage:50){media(idMal_in:$ids,type:ANIME){id idMal synonyms}}}"


def post(query, ids):
    body = json.dumps({"query": query, "variables": {"ids": ids}})
    for attempt in range(3):
        out = subprocess.run(
            ["curl.exe", "-sS", "--max-time", "60", "-H", "Content-Type: application/json",
             "-H", "Accept: application/json", "--data-binary", "@-", URL],
            input=body.encode("utf-8"), capture_output=True, check=True,
        ).stdout.decode("utf-8")
        data = json.loads(out)
        if "errors" in data and any(e.get("status") == 429 for e in data["errors"]):
            time.sleep(60)
            continue
        return data["data"]["Page"]["media"]
    raise RuntimeError("rate limited")


with open(names_path, encoding="utf-8") as f:
    names = json.load(f)

by_al = {n["al"]: k for k, n in names.items() if n.get("al")}
by_mal = {n["mal"]: k for k, n in names.items() if n.get("mal") and not n.get("al")}

result = {}
requested = 0
for query, table, field in ((QUERY_BY_ID, by_al, "id"), (QUERY_BY_MAL, by_mal, "idMal")):
    ids = sorted(table)
    for i in range(0, len(ids), PAGE):
        batch = ids[i:i + PAGE]
        for media in post(query, batch):
            ann_id = table.get(media[field])
            requested += 1
            thai = [s for s in media["synonyms"] if THAI.search(s)]
            if ann_id and thai:
                result[ann_id] = thai
        time.sleep(1.0)

with open(out_path, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=1)

print(f"AniList media checked: {requested}")
print(f"with a Thai-script synonym: {len(result)}")
