"""Fetch the Japanese (native) title of every AMQ anime from AniList, used to match titles from Thai streaming sites.

Usage: python -I fetch_native.py [anime_names.json] [anilist_native.json]
Output {annId: {"native": ..., "romaji": ..., "english": ...}}. Uses the public GraphQL API at <= 1 request/second.
"""
import json
import subprocess
import sys
import time

names_path = sys.argv[1] if len(sys.argv) > 1 else "anime_names.json"
out_path = sys.argv[2] if len(sys.argv) > 2 else "anilist_native.json"
URL = "https://graphql.anilist.co"
PAGE = 50
TITLE = "{id idMal title{native romaji english}}"
QUERIES = {"id": "query($ids:[Int]){Page(perPage:50){media(id_in:$ids,type:ANIME)" + TITLE + "}}",
           "idMal": "query($ids:[Int]){Page(perPage:50){media(idMal_in:$ids,type:ANIME)" + TITLE + "}}"}


def post(query, ids):
    body = json.dumps({"query": query, "variables": {"ids": ids}}).encode()
    for _ in range(4):
        out = subprocess.run(["curl.exe", "-sS", "--max-time", "60", "-H", "Content-Type: application/json",
                              "--data-binary", "@-", URL], input=body, capture_output=True, check=True).stdout.decode("utf-8")
        data = json.loads(out)
        if "errors" in data and any(e.get("status") == 429 for e in data["errors"]):
            time.sleep(60)
            continue
        return data["data"]["Page"]["media"]
    raise RuntimeError("rate limited")


with open(names_path, encoding="utf-8") as f:
    names = json.load(f)
tables = {"id": {n["al"]: k for k, n in names.items() if n.get("al")},
          "idMal": {n["mal"]: k for k, n in names.items() if n.get("mal") and not n.get("al")}}
result = {}
for field, table in tables.items():
    ids = sorted(table)
    for i in range(0, len(ids), PAGE):
        for m in post(QUERIES[field], ids[i:i + PAGE]):
            ann_id = table.get(m["id"] if field == "id" else m["idMal"])
            if ann_id:
                result[ann_id] = m["title"]
        time.sleep(1.0)
        print(f"  {field}: {min(i + PAGE, len(ids))}/{len(ids)}", flush=True)
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, separators=(",", ":"))
print(f"native titles: {sum(1 for t in result.values() if t.get('native'))} of {len(names)} anime")
