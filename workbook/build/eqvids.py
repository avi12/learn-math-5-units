import json, base64, urllib.request, urllib.parse
UA = {"User-Agent": "Mozilla/5.0"}
ids = ["IHmnSYj1gPA", "M89lTUQBtTo", "m4eiYHL3PP8", "BRRolKTlF6Q", "ea9kgUY0FSw", "dsBOW0sqJvE"]
out = {}
for i in ids:
    u = "https://www.youtube.com/oembed?url=" + urllib.parse.quote(
        "https://www.youtube.com/watch?v=" + i, safe="") + "&format=json"
    d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=20))
    th = d["thumbnail_url"].replace("hqdefault", "mqdefault")
    b = urllib.request.urlopen(urllib.request.Request(th, headers=UA), timeout=20).read()
    out[i] = {"title": d["title"], "author": d["author_name"], "b64": base64.b64encode(b).decode()}
    print(f"{i} | {d['author_name'][:28]:28} | {d['title'][:58]}")
with open("eqvids.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)
print("b64 kb:", sum(len(v["b64"]) for v in out.values()) // 1024)
