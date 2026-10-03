import re, json, html

# spans that are NOT math and must stay as code chips
CODE = {
    ".../sheeloney_bagrut/&lt;שנה&gt;/&lt;מועד&gt;/HEB/35571.pdf",
    "35572",
}

# hand-written LaTeX where the auto pass cannot do it well
MANUAL = {
    "(x&sup2; &minus; 5x + 6) / (x &minus; 2) = 4": r"\frac{x^{2}-5x+6}{x-2}=4",
    "f(x) = &radic;(2x + 7) / (x&sup2; &minus; 5x + 6)": r"f(x)=\dfrac{\sqrt{2x+7}}{x^{2}-5x+6}",
    "&int;&#8320;&sup2; (3x&sup2; + 2x) dx": r"\int_{0}^{2}\left(3x^{2}+2x\right)dx",
    "&int;&#8320;<sup>&pi;/2</sup> f(x) dx": r"\int_{0}^{\pi/2} f(x)\,dx",
    "&int;<sub>&minus;2</sub><sup>1</sup> (2 &minus; x &minus; x&sup2;) dx = 4.5": r"\int_{-2}^{1}\left(2-x-x^{2}\right)dx=4.5",
    "&int;<sub>&minus;2</sub><sup>2</sup> (4 &minus; x&sup2;) dx = 32/3 &asymp; 10.67": r"\int_{-2}^{2}\left(4-x^{2}\right)dx=\tfrac{32}{3}\approx 10.67",
    "S = &int;&#8320;&sup2; (2x &minus; x&sup2;) dx = 4 &minus; 8/3 = 4/3": r"S=\int_{0}^{2}\left(2x-x^{2}\right)dx=4-\tfrac{8}{3}=\tfrac{4}{3}",
    "[&frac12;sin2x + 2sin x]&#8320;<sup>&pi;/2</sup> = 2": r"\left[\tfrac{1}{2}\sin 2x+2\sin x\right]_{0}^{\pi/2}=2",
    "[x&sup3; + x&sup2;]&#8320;&sup2; = (8 + 4) &minus; 0 = 12": r"\left[x^{3}+x^{2}\right]_{0}^{2}=(8+4)-0=12",
    "(4/3)(4 &minus; c)<sup>3/2</sup>": r"\tfrac{4}{3}(4-c)^{3/2}",
    "x = &plusmn;&radic;(4&minus;c)": r"x=\pm\sqrt{4-c}",
    "4 &minus; c = 1": r"4-c=1",
    "f(x) = (x&sup2; &minus; a&sup2;)/x": r"f(x)=\dfrac{x^{2}-a^{2}}{x}",
    "f(x) = (x&sup2; + 3)/(x &minus; 1)": r"f(x)=\dfrac{x^{2}+3}{x-1}",
    "f&prime;(x) = (x&minus;3)(x+1)/(x&minus;1)&sup2;": r"f'(x)=\dfrac{(x-3)(x+1)}{(x-1)^{2}}",
    "f&prime;(x) = 1 + a&sup2;/x&sup2;": r"f'(x)=1+\dfrac{a^{2}}{x^{2}}",
    "h&prime;(x) = &minus;1 + a&sup2;/x&sup2; = 0": r"h'(x)=-1+\dfrac{a^{2}}{x^{2}}=0",
    "h(x) = &minus;x &minus; a&sup2;/x": r"h(x)=-x-\dfrac{a^{2}}{x}",
    "S = x&sup2; + 4xh = x&sup2; + 128/x": r"S=x^{2}+4xh=x^{2}+\dfrac{128}{x}",
    "S&prime; = 2x &minus; 128/x&sup2; = 0": r"S'=2x-\dfrac{128}{x^{2}}=0",
    "2/&radic;(4t+5) &minus; 1 = 0": r"\dfrac{2}{\sqrt{4t+5}}-1=0",
    "1 + 2 + 3 + ... + n = n(n+1)/2": r"1+2+3+\dots+n=\frac{n(n+1)}{2}",
    "1/(1&middot;2) + 1/(2&middot;3) + ... + 1/(n(n+1)) = n/(n+1)":
        r"\frac{1}{1\cdot 2}+\frac{1}{2\cdot 3}+\dots+\frac{1}{n(n+1)}=\frac{n}{n+1}",
    "4 + 8 + 12 + ... + 2n = n(n + 2)/2": r"4+8+12+\dots+2n=\frac{n(n+2)}{2}",
    "n(n+1)/2 + (n+1) = (n+1)(n+2)/2": r"\frac{n(n+1)}{2}+(n+1)=\frac{(n+1)(n+2)}{2}",
    "n(n+2)/2 + 2n + 4 = (n+2)(n+4)/2": r"\frac{n(n+2)}{2}+2n+4=\frac{(n+2)(n+4)}{2}",
    "n/(n+1) + 1/((n+1)(n+2)) = (n&sup2;+2n+1)/((n+1)(n+2)) = (n+1)/(n+2)":
        r"\frac{n}{n+1}+\frac{1}{(n+1)(n+2)}=\frac{n^{2}+2n+1}{(n+1)(n+2)}=\frac{n+1}{n+2}",
    "1&middot;2/2 = 1": r"\frac{1\cdot 2}{2}=1",
    "2&middot;4/2 = 4": r"\frac{2\cdot 4}{2}=4",
    "a&#8325;/a&#8322; = q&sup3; = 8": r"\frac{a_{5}}{a_{2}}=q^{3}=8",
    "S&#8321;&#8320; = 10&middot;(5 + 32)/2 = 185": r"S_{10}=\frac{10\cdot(5+32)}{2}=185",
    "S&#8328; = 6&middot;(2&#8312; &minus; 1)/(2 &minus; 1) = 1530": r"S_{8}=\frac{6\left(2^{8}-1\right)}{2-1}=1530",
    "q = 6/18 = 1/3": r"q=\tfrac{6}{18}=\tfrac{1}{3}",
    "S = 18/(1 &minus; 1/3) = 27": r"S=\frac{18}{1-\tfrac{1}{3}}=27",
    "S = 324/(1 &minus; 1/9) = 364.5": r"S=\frac{324}{1-\tfrac{1}{9}}=364.5",
    "b&#8345;&#8330;&#8321;/b&#8345; = (a&#8345;&#8330;&#8321;/a&#8345;)&sup2; = q&sup2;":
        r"\frac{b_{n+1}}{b_{n}}=\left(\frac{a_{n+1}}{a_{n}}\right)^{2}=q^{2}",
    "b&#8345; = (a&#8345;)&sup2;": r"b_{n}=\left(a_{n}\right)^{2}",
    "27 : 364.5 = 2 : 27": r"27:364.5=2:27",
    "1/9": r"\tfrac{1}{9}",
    "4/3": r"\tfrac{4}{3}",
    "(5/8)&middot;(4/7) = 20/56 = 5/14 &asymp; 0.357":
        r"\tfrac{5}{8}\cdot\tfrac{4}{7}=\tfrac{20}{56}=\tfrac{5}{14}\approx 0.357",
    "P = (0.6&middot;0.7) / (0.6&middot;0.7 + 0.4&middot;0.4) = 0.42/0.58 = 21/29 &asymp; 0.724":
        r"P=\frac{0.6\cdot 0.7}{0.6\cdot 0.7+0.4\cdot 0.4}=\frac{0.42}{0.58}=\tfrac{21}{29}\approx 0.724",
    "0.16/0.58 = 8/29 &asymp; 0.276": r"\frac{0.16}{0.58}=\tfrac{8}{29}\approx 0.276",
    "C(5,2)&middot;0.58&sup2;&middot;0.42&sup3; &asymp; 0.249": r"\binom{5}{2}\cdot 0.58^{2}\cdot 0.42^{3}\approx 0.249",
    "P(תפוח)&sup2; = 0.36": r"P^{2}=0.36",
    "4/10 = 5/AC": r"\frac{4}{10}=\frac{5}{AC}",
    "AD/CD = CD/DB": r"\frac{AD}{CD}=\frac{CD}{DB}",
    "b = 12&middot;sin75&deg;/sin40&deg; &asymp; 18.03":
        r"b=\frac{12\sin 75^{\circ}}{\sin 40^{\circ}}\approx 18.03",
    "S = &frac12;&middot;a&middot;b&middot;sin65&deg; &asymp; 98.06": r"S=\tfrac{1}{2}ab\sin 65^{\circ}\approx 98.06",
    "S = &frac12;&middot;k&middot;k&middot;sin2&alpha;": r"S=\tfrac{1}{2}k^{2}\sin 2\alpha",
    "S = &frac12;&middot;13&middot;6 = 39": r"S=\tfrac{1}{2}\cdot 13\cdot 6=39",
    "c&sup2; = a&sup2; + b&sup2; &minus; 2ab&middot;cos&gamma;": r"c^{2}=a^{2}+b^{2}-2ab\cos\gamma",
    "c&sup2; = 49 + 81 &minus; 2&middot;7&middot;9&middot;0.5 = 67": r"c^{2}=49+81-2\cdot 7\cdot 9\cdot 0.5=67",
    "&radic;((2a)&sup2; + (4a)&sup2;) = 2a&radic;5 = 10": r"\sqrt{(2a)^{2}+(4a)^{2}}=2a\sqrt{5}=10",
    "AB = &radic;(36 + 64) = 10": r"AB=\sqrt{36+64}=10",
    "CD = &radic;36 = 6": r"CD=\sqrt{36}=6",
    "c = &radic;67 &asymp; 8.19": r"c=\sqrt{67}\approx 8.19",
    "a = &radic;5": r"a=\sqrt{5}",
    "AB = &radic;(4t+5) &minus; (t+2)": r"AB=\sqrt{4t+5}-(t+2)",
    "&radic;(4t+5) = 2": r"\sqrt{4t+5}=2",
    "&radic;(4x+5) = x+2": r"\sqrt{4x+5}=x+2",
    "&radic;(2x + 7) = x + 2": r"\sqrt{2x+7}=x+2",
    "f(x) = &radic;(4x + 5)": r"f(x)=\sqrt{4x+5}",
    "&#9651;ACD ~ &#9651;CBD": r"\triangle ACD\sim\triangle CBD",
    "&#9651;ADE ~ &#9651;ABC": r"\triangle ADE\sim\triangle ABC",
    "DE &#8214; BC": r"DE\parallel BC",
    "f(&minus;x) = cos(&minus;2x) + b&middot;cos(&minus;x) = cos2x + b&middot;cos x = f(x)":
        r"f(-x)=\cos(-2x)+b\cos(-x)=\cos 2x+b\cos x=f(x)",
    "f&prime;(x) = &minus;2sin2x &minus; b&middot;sin x = &minus;sin x (4cos x + b)":
        r"f'(x)=-2\sin 2x-b\sin x=-\sin x\,(4\cos x+b)",
    "f&prime;(x) = &minus;2sin x (1 + 2cos x)": r"f'(x)=-2\sin x\,(1+2\cos x)",
    "50&middot;sin2&alpha; = 40": r"50\sin 2\alpha=40",
    "sin2&alpha; = 0.8": r"\sin 2\alpha=0.8",
    "BC = 2k&middot;sin&alpha;": r"BC=2k\sin\alpha",
    "k&middot;sin&alpha;": r"k\sin\alpha",
    "k&middot;cos&alpha; &asymp; 8.94": r"k\cos\alpha\approx 8.94",
    "4&middot;(&minus;&frac12;) + b = 0": r"4\cdot\left(-\tfrac{1}{2}\right)+b=0",
    "0.6&middot;0.7 + 0.4&middot;0.4 = 0.42 + 0.16 = 0.58": r"0.6\cdot 0.7+0.4\cdot 0.4=0.42+0.16=0.58",
    "|2x &minus; 1| &lt; 5": r"\left|2x-1\right|<5",
    "0.4&sup2; = 0.16": r"0.4^{2}=0.16",
    "f(x) = cos2x + b&middot;cos x": r"f(x)=\cos 2x+b\cos x",
    "f(x) = 2cos x + cos 2x": r"f(x)=2\cos x+\cos 2x",
    "f&prime;(x) = 2cos(2x) = 0": r"f'(x)=2\cos(2x)=0",
    "f(x) = sin(2x)": r"f(x)=\sin(2x)",
    "P(x) = x(20 &minus; x)": r"P(x)=x(20-x)",
    "P&prime; = 20 &minus; 2x = 0": r"P'=20-2x=0",
    "&#8736;BAC = 2&alpha;": r"\angle BAC=2\alpha",
    "&#8736;A = 40&deg;": r"\angle A=40^{\circ}",
    "&#8736;B = 75&deg;": r"\angle B=75^{\circ}",
}

SUB = {"&#8320;": "0", "&#8321;": "1", "&#8322;": "2", "&#8323;": "3", "&#8324;": "4",
       "&#8325;": "5", "&#8326;": "6", "&#8327;": "7", "&#8328;": "8", "&#8329;": "9",
       "&#8345;": "n", "&#8330;": "+"}
SIMPLE = [
    ("&minus;", "-"), ("&plusmn;", r"\pm "), ("&middot;", r"\cdot "), ("&asymp;", r"\approx "),
    ("&le;", r"\le "), ("&ge;", r"\ge "), ("&ne;", r"\ne "), ("&lt;", "<"), ("&gt;", ">"),
    ("&alpha;", r"\alpha "), ("&pi;", r"\pi "), ("&gamma;", r"\gamma "), ("&deg;", r"^{\circ}"),
    ("&frac12;", r"\tfrac{1}{2}"), ("&prime;", "'"), ("&#8736;", r"\angle "),
    ("&#9651;", r"\triangle "), ("&#8214;", r"\parallel "), ("&sup2;", "^{2}"), ("&sup3;", "^{3}"),
    ("&#8312;", "^{8}"), ("...", r"\dots "), ("~", r"\sim "),
]


def auto(t):
    # subscript digits that trail a latin identifier
    def subs(m):
        return m.group(1) + "_{" + "".join(SUB[e] for e in re.findall(r"&#\d+;", m.group(2))) + "}"
    t = re.sub(r"([A-Za-z])((?:&#83[2-4]\d;)+)", subs, t)
    t = re.sub(r"<sup>(.*?)</sup>", r"^{\1}", t)
    t = re.sub(r"<sub>(.*?)</sub>", r"_{\1}", t)
    for a, b in SIMPLE:
        t = t.replace(a, b)
    t = re.sub(r"\b(sin|cos|tan|log|ln)\b", r"\\\1 ", t)
    return re.sub(r"\s+", " ", t).strip()


def build():
    s = open("workbook.html", encoding="utf-8").read()
    spans = sorted(set(re.findall(r'<span class="m">(.*?)</span>', s)))
    out = {}
    for x in spans:
        if x in CODE:
            continue
        out[x] = MANUAL.get(x) or auto(x)
    json.dump(out, open("texmap.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    manual_n = sum(1 for x in out if x in MANUAL)
    print("math spans:", len(out), "| manual:", manual_n, "| auto:", len(out) - manual_n)
    print("--- auto-converted (review these) ---")
    for x in spans:
        if x in out and x not in MANUAL:
            print(f"  {x:52} => {out[x]}")


if __name__ == "__main__":
    build()
