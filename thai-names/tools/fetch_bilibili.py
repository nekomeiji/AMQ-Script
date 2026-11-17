"""Fetch the Thai title and the original (Japanese) title of every series listed in bilibili.tv's OGV sitemap.

Usage: python -I tools/fetch_bilibili.py [bilibili_pages.json]
Output {playId: {"th": Thai series title, "native": "ชื่อเดิม" text, "alias": [...]}}. Only the public HTML page of each
series is read, at 1 request/second; the file is saved every 50 pages so an interrupted run resumes where it stopped.
"""
import html
import json
import os
import re
import subprocess
import sys
import time

out_path = sys.argv[1] if len(sys.argv) > 1 else "bilibili_pages.json"
SITEMAP = "https://www.bilibili.tv/sitemap/ogv-play-0.xml"
PAGE = "https://www.bilibili.tv/th/play/"
AGENT = "Mozilla/5.0 (AMQ-thai-names research; polite 1 req/s)"


def get(url):
    out = subprocess.run(["curl.exe", "-sS", "--max-time", "30", "-A", AGENT, url], capture_output=True)
    return out.stdout.decode("utf-8", "replace")


def text_of(fragment):
    return html.unescape(re.sub(r"<[^>]+>", "", fragment)).strip()


def parse(page):
    og = re.search(r'<meta property="og:title" content="([^"]*)"', page)
    native = re.search(r'bstar-meta__origin-name-content[^>]*>(.*?)</div>', page, re.S)
    alias = re.findall(r'bstar-meta__alias-item[^>]*>(.*?)</div>', page, re.S)
    th = re.sub(r"\s*(HD\s*)?\|\s*bilibili\s*$", "", html.unescape(og.group(1))).strip() if og else None
    return {"th": th, "native": text_of(native.group(1)) if native else None,
            "alias": [a for a in (text_of(x) for x in alias) if a]}


result = {}
if os.path.exists(out_path):
    with open(out_path, encoding="utf-8") as f:
        result = json.load(f)
ids = list(dict.fromkeys(re.findall(r"/play/(\d+)", get(SITEMAP))))  # each series is listed once per language
todo = [i for i in ids if i not in result]
print(f"series in sitemap: {len(ids)}, already fetched: {len(result)}, to fetch: {len(todo)}", flush=True)
for n, i in enumerate(todo, 1):
    result[i] = parse(get(PAGE + i))
    time.sleep(1.0)
    if n % 50 == 0:
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, separators=(",", ":"))
        print(f"  {n}/{len(todo)}", flush=True)
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, separators=(",", ":"))
print(f"done: {len(result)} pages, {sum(1 for v in result.values() if v['native'])} with an original title")

