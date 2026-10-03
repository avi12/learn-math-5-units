import json, base64, urllib.request, urllib.parse
UA = {"User-Agent": "Mozilla/5.0"}
items = [
    ("v", "dsBOW0sqJvE"), ("v", "jLrWQFm5JBE"), ("v", "HZGCoVF3YvM"), ("v", "Tl3VMrv5YGI"),
    ("v", "9vKqVkMQHKk"), ("v", "rfG8ce4nNh0"),
    ("p", "PLejElsCmvhTCv3be0j6qtOB4lvUHH9S1T"), ("p", "PLejElsCmvhTBGdjf67dBrSp4JL_zDwCUj"),
    ("p", "PLejElsCmvhTDiPu0BM7cb5ppFUFp67yVz"), ("p", "PLejElsCmvhTDnqja0ca1rRZYOEa-guHbN"),
    ("p", "PLejElsCmvhTCMuHr4kRS78xslVPnFnTfD"), ("p", "PLejElsCmvhTCbLQcjKCkMpWouhn6-Yv1v"),
    # block 08 is derivatives of trig functions, so it wants function investigation - not
    # PLejElsCmvhTApERQoHTgzn9KURYz-dmd6, the unit-circle playlist that belongs to 06.
    ("p", "PLejElsCmvhTDnp4715Yeo63GAMODGd5Ty"), ("p", "PLejElsCmvhTBGuAUUC5AlLVq1O7V0CoG3"),
    # block 10 wants integrals of its own, not block 07's rational-function course.
    ("p", "PLejElsCmvhTCHvoOUyGzC0DFb-OZ_72wH"),
    ("p", "PLejElsCmvhTAJ_arxp4e71c0PlDo3oP1S"), ("p", "PLejElsCmvhTAnOL87qVh1SkyT40-BbFb0"),
    ("p", "PLIhyVMxlQ9lJWbbd9vKGFIkJ4kZyozchp"), ("p", "PLIhyVMxlQ9lLdsUCY30ceB051O4oNZVhX"),
]
out = {}
for kind, i in items:
    url = ("https://www.youtube.com/watch?v=" + i) if kind == "v" else ("https://www.youtube.com/playlist?list=" + i)
    q = "https://www.youtube.com/oembed?url=" + urllib.parse.quote(url, safe="") + "&format=json"
    try:
        d = json.load(urllib.request.urlopen(urllib.request.Request(q, headers=UA), timeout=20))
    except Exception as e:
        print("FAIL", i, e); continue
    th = d["thumbnail_url"].replace("hqdefault", "mqdefault")
    b = urllib.request.urlopen(urllib.request.Request(th, headers=UA), timeout=20).read()
    out[i] = {"kind": kind, "url": url, "title": d["title"], "author": d["author_name"],
              "b64": base64.b64encode(b).decode()}
    print(f"{i:36} {kind} | {d['author_name'][:26]:26} | {d['title'][:56]}")
with open("blockvids.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)
print("total", len(out), "| b64 kb", sum(len(v["b64"]) for v in out.values()) // 1024)
