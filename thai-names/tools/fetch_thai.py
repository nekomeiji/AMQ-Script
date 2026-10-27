"""Fetch Thai anime titles from Wikidata and match them to AMQ annIds via MAL / AniList ids.

Usage: python -I fetch_thai.py [anime_names.json] [thai_names.json]
Does not touch thai_overrides.json. Entries with no Thai label are stored with th = null
so later runs can skip them.
"""
import datetime
import json
import subprocess
import sys
import urllib.parse

names_path = sys.argv[1] if len(sys.argv) > 1 else "anime_names.json"
out_path = sys.argv[2] if len(sys.argv) > 2 else "thai_names.json"

ENDPOINT = "https://query.wikidata.org/sparql"
USER_AGENT = "AMQ-thai-names/0.1 (https://github.com/nekomeiji/AMQ-Script)"

QUERY = """
SELECT ?item ?mal ?al ?label ?enlabel (GROUP_CONCAT(DISTINCT ?alias; separator="|") AS ?aliases) WHERE {
  { ?item wdt:P4086 ?mal } UNION { ?item wdt:P8729 ?al }
  ?item rdfs:label ?label . FILTER(LANG(?label) = "th")
  OPTIONAL { ?item rdfs:label ?enlabel . FILTER(LANG(?enlabel) = "en") }
  OPTIONAL { ?item skos:altLabel ?alias . FILTER(LANG(?alias) = "th") }
}
GROUP BY ?item ?mal ?al ?label ?enlabel
"""


def run_query():
    # curl.exe uses the Windows certificate store; Python 3.10's bundled OpenSSL rejects the chain.
    url = ENDPOINT + "?" + urllib.parse.urlencode({"query": QUERY, "format": "json"})
    out = subprocess.run(
        ["curl.exe", "-sS", "--fail", "--max-time", "180", "-H", "User-Agent: " + USER_AGENT,
         "-H", "Accept: application/sparql-results+json", url],
        capture_output=True, check=True,
    ).stdout
    return json.loads(out.decode("utf-8"))["results"]["bindings"]


rows = run_query()
print(f"wikidata rows with a Thai label: {len(rows)}")

by_mal, by_al = {}, {}
for r in rows:
    qid = r["item"]["value"].rsplit("/", 1)[-1]
    th = r["label"]["value"]
    alias = [a for a in r.get("aliases", {}).get("value", "").split("|") if a and a != th]
    entry = {"th": th, "alt": alias, "src": "wikidata", "ref": qid, "en": r.get("enlabel", {}).get("value", "")}
    if "mal" in r:
        by_mal.setdefault(int(r["mal"]["value"]), entry)
    if "al" in r:
        by_al.setdefault(int(r["al"]["value"]), entry)

with open(names_path, encoding="utf-8") as f:
    names = json.load(f)

today = datetime.date.today().isoformat()
result = {}
for ann_id, n in names.items():
    hit = by_mal.get(n.get("mal")) or by_al.get(n.get("al"))
    if hit:
        result[ann_id] = {**hit, "at": today}
    else:
        result[ann_id] = {"th": None, "src": "wikidata", "at": today}

with open(out_path, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, separators=(",", ":"))

found = sum(1 for e in result.values() if e["th"])
with_id = sum(1 for n in names.values() if n.get("mal") or n.get("al"))
print(f"AMQ anime: {len(names)}, with MAL/AniList id: {with_id}")
print(f"Thai title found: {found} ({found / len(names):.1%} of all, {found / with_id:.1%} of those with an id)")
