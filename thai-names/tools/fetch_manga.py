"""Find Thai titles of the source manga of AMQ anime that still have no Thai title.

Usage: python -I tools/fetch_manga.py [anime_names.json] [bundle.json] [manga_thai.json]
1. AniList: the ADAPTATION relation of each anime gives its source manga (AniList + MAL ids).
2. MangaDex: search the manga by title, accept a hit only when its links.mal / links.al match the manga ids,
   and keep the Thai alt titles.
Output manga_thai.json: {annId: {"manga": romaji, "al": id, "mal": id, "th": [titles]}} for every anime with a manga source.
Progress is cached in cache/manga/state.json, so an interrupted run resumes. Requests are spaced out
(AniList <= 90/min, MangaDex ~3/s).
"""
import json
import os
import subprocess
import sys
import time
import urllib.parse

names_path = sys.argv[1] if len(sys.argv) > 1 else "anime_names.json"
bundle_path = sys.argv[2] if len(sys.argv) > 2 else "bundle.json"
out_path = sys.argv[3] if len(sys.argv) > 3 else "manga_thai.json"
STATE = os.path.join("cache", "manga", "state.json")

ANILIST = "https://graphql.anilist.co"
PAGE = 50
RELATIONS = ("{Page(perPage:50){media(%s_in:$ids,type:ANIME){id idMal relations{edges{relationType node"
             "{id idMal type format title{romaji english}}}}}}}")


def curl(args, data=None):
    out = subprocess.run(["curl.exe", "-sS", "--max-time", "60"] + args, input=data, capture_output=True, check=True)
    return out.stdout.decode("utf-8")


def anilist(field, ids):
    body = json.dumps({"query": "query($ids:[Int])" + RELATIONS % field, "variables": {"ids": ids}}).encode()
    for _ in range(4):
        data = json.loads(curl(["-H", "Content-Type: application/json", "--data-binary", "@-", ANILIST], body))
        if "errors" in data and any(e.get("status") == 429 for e in data["errors"]):
            time.sleep(60)
            continue
        return data["data"]["Page"]["media"]
    raise RuntimeError("AniList rate limited")


def mangadex(title):
    url = "https://api.mangadex.org/manga?limit=10&title=" + urllib.parse.quote(title)
    for _ in range(4):
        res = json.loads(curl([url]))
        if res.get("result") == "error" and any(e.get("status") == 429 for e in res.get("errors", [])):
            time.sleep(30)
            continue
        return res.get("data", [])
    return []


def save(state):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, separators=(",", ":"))


with open(names_path, encoding="utf-8") as f:
    names = json.load(f)
with open(bundle_path, encoding="utf-8") as f:
    have = {str(i[0]) for i in json.load(f)["items"]}
state = {"source": {}, "mangadex": {}}
if os.path.exists(STATE):
    with open(STATE, encoding="utf-8") as f:
        state = json.load(f)

# Step 1: source manga per anime (anime without a Thai title and with an AniList or MAL id)
missing = {k: n for k, n in names.items() if k not in have and (n.get("al") or n.get("mal"))}
todo = {"id": {}, "idMal": {}}
for k, n in missing.items():
    if k in state["source"]:
        continue
    if n.get("al"):
        todo["id"][n["al"]] = k
    else:
        todo["idMal"][n["mal"]] = k
print(f"anime without a Thai title: {len(missing)}, source lookups to do: {len(todo['id']) + len(todo['idMal'])}", flush=True)
for field, table in todo.items():
    ids = sorted(table)
    for i in range(0, len(ids), PAGE):
        for media in anilist(field, ids[i:i + PAGE]):
            ann_id = table.get(media["id"] if field == "id" else media["idMal"])
            if not ann_id:
                continue
            node = next((e["node"] for e in media["relations"]["edges"]
                         if e["relationType"] == "ADAPTATION" and e["node"]["type"] == "MANGA"), None)
            state["source"][ann_id] = node
        for ann_id in (table[x] for x in ids[i:i + PAGE]):
            state["source"].setdefault(ann_id, None)  # asked, nothing returned
        save(state)
        time.sleep(1.5)
        print(f"  {field}: {min(i + PAGE, len(ids))}/{len(ids)}", flush=True)

# Step 2: Thai titles of each distinct manga
mangas = {}
for node in state["source"].values():
    if node:
        mangas[str(node["id"])] = node
pending = [k for k in mangas if k not in state["mangadex"]]
print(f"manga: {len(mangas)}, MangaDex lookups to do: {len(pending)}", flush=True)
for number, key in enumerate(pending, 1):
    node = mangas[key]
    result = None
    for title in dict.fromkeys(t for t in (node["title"].get("romaji"), node["title"].get("english")) if t):
        for d in mangadex(title):
            a = d["attributes"]
            links = a.get("links") or {}
            if str(links.get("al")) == str(node["id"]) or (node["idMal"] and str(links.get("mal")) == str(node["idMal"])):
                th = [v["th"] for v in a.get("altTitles", []) if "th" in v]
                if "th" in a.get("title", {}):
                    th.insert(0, a["title"]["th"])
                result = {"uuid": d["id"], "th": list(dict.fromkeys(th))}
                break
        time.sleep(0.35)
        if result:
            break
    state["mangadex"][key] = result  # None = not found on MangaDex
    if number % 50 == 0:
        save(state)
        print(f"  mangadex: {number}/{len(pending)}", flush=True)
save(state)

out = {}
for ann_id, node in state["source"].items():
    if not node:
        continue
    md = state["mangadex"].get(str(node["id"]))
    out[ann_id] = {"manga": node["title"].get("romaji") or node["title"].get("english"), "al": node["id"],
                   "mal": node["idMal"], "found": bool(md), "th": md["th"] if md else []}
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
with_th = sum(1 for e in out.values() if e["th"])
print(f"anime with a manga source: {len(out)}, found on MangaDex: {sum(1 for e in out.values() if e['found'])}, "
      f"with a Thai title: {with_th}")
