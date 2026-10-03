from sympy import *
x, t, a, b, c, k, n, q = symbols('x t a b c k n q', real=True)
def s(t_, v): print(f"{t_:46} -> {v}")

# B2 sequences (inspired)
a1, a2 = 18, 6
qv = Rational(a2, a1); s("B2 q, a1", (qv, a1))
Sa = a1/(1-qv); s("B2 S_infinite a", Sa)
b1 = a1**2; Sb = b1/(1-qv**2); s("B2 b1, S_b", (b1, Sb))
s("B2 ratio Sa/Sb", nsimplify(Sa/Sb))

# B3 induction closed form: 4+8+...+2n for even n
m = symbols('m', positive=True, integer=True)
lhs = summation(4*m, (m, 1, n/2))
s("B3 sum 4m m=1..n/2", simplify(lhs), )
s("B3 equals n(n+2)/2 ?", simplify(lhs - n*(n+2)/2))

# B4 probability (inspired)
pa = sqrt(Rational(36,100)); s("B4 P(apple)", pa)
pex = pa*Rational(7,10) + (1-pa)*Rational(4,10); s("B4 P(export)", (pex, float(pex)))
s("B4 P(pear|export)", (nsimplify((1-pa)*Rational(4,10)/pex), float((1-pa)*Rational(4,10)/pex)))
ber = binomial(5,2)*pex**2*(1-pex)**3; s("B4 Bernoulli exactly 2 of 5", (nsimplify(ber), float(ber)))

# B5 geometry (inspired): CD^2 = AD*DB
AD, DB = 4, 9
s("B5 CD, AB, R, area", (sqrt(AD*DB), AD+DB, Rational(AD+DB,2), Rational(1,2)*(AD+DB)*sqrt(AD*DB)))

# B6 trig (inspired): isosceles k=10, area 40
al = symbols('al', positive=True)
sols = solve(Eq(50*sin(2*al), 40), al)
s("B6 2a solutions (deg)", [float(deg(2*v)) for v in sols])
a_small = min(sols, key=lambda v: float(v))
s("B6 BC, height for small 2a", (float(2*10*sin(a_small)), float(10*cos(a_small))))

# B7 rational (inspired): f=(x^2-a^2)/x, h=f-2x
f7 = (x**2 - a**2)/x
s("B7 f'", simplify(diff(f7, x)))
h7 = simplify(f7 - 2*x); s("B7 h", h7)
cps = solve(diff(h7, x), x); s("B7 h crit", [(p, simplify(h7.subs(x, p))) for p in cps])
d = sqrt((2*a)**2 + (4*a)**2); s("B7 dist between extrema", simplify(d))
s("B7 a when dist=10", solve(Eq(simplify(d), 10), a))

# B8 trig function (inspired): f = cos2x + b cos x
f8 = cos(2*x) + b*cos(x)
s("B8 b for extremum at 2pi/3", solve(Eq(diff(f8, x).subs(x, 2*pi/3), 0), b))
f8b = cos(2*x) + 2*cos(x)
cps8 = solve(Eq(diff(f8b, x), 0), x)
s("B8 crit pts", [(p, simplify(f8b.subs(x, p))) for p in cps8])
s("B8 f at 0, 2pi/3, pi", (f8b.subs(x,0), simplify(f8b.subs(x,2*pi/3)), simplify(f8b.subs(x,pi))))
s("B8 integral 0..pi/2", simplify(integrate(f8b, (x, 0, pi/2))))
root8 = solve(Eq(f8b, 0), x); s("B8 zero in (0,pi/2)", [float(r) for r in root8 if r.is_real])

# B9 optimization (inspired)
f9 = sqrt(4*x + 5)
s("B9 intersections with x+2", solve(Eq(f9, x+2), x))
AB = sqrt(4*t+5) - (t+2)
tc = solve(diff(AB, t), t); s("B9 t max, AB max", [(p, simplify(AB.subs(t, p))) for p in tc])

# B10 area (inspired)
s("B10 intersections 4-x^2 and x+2", solve(Eq(4-x**2, x+2), x))
s("B10 area between", integrate((4-x**2)-(x+2), (x, -2, 1)))
s("B10 area f with x-axis", integrate(4-x**2, (x, -2, 2)))
cc = symbols('cc', positive=True)
area_c = integrate(4-x**2-cc, (x, -sqrt(4-cc), sqrt(4-cc)))
s("B10 area(c) formula", simplify(area_c))
s("B10 c for area 9/2", solve(Eq(simplify(area_c), Rational(9,2)), cc))
