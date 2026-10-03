"""Every numeric claim in build/content.py, checked in sympy. `python build/verify9.py`

The rule in CLAUDE.md is that no exercise reaches the page before its answer has been
verified symbolically, and 60 new exercises is exactly the volume at which hand-checking
stops working. Each check below states the answer written on the page and asserts it
against sympy, so a typo in an answer fails the build rather than reaching Avi.

Nothing here reads the HTML: it re-solves the mathematics from scratch. That is the
point - if the two disagree, the page is wrong until proven otherwise.
"""
from fractions import Fraction as F

import sympy as sp

x, n, k, t = sp.symbols("x n k t", real=True)
# radii are positive, and saying so is what lets sympy simplify R*Abs(R) to R**2
r, R = sp.symbols("r R", positive=True)
ok, bad = 0, []


def eq(label, got, want):
    """`got` is what sympy derives, `want` is what the page says."""
    global ok
    g = sp.nsimplify(got) if not isinstance(got, (list, tuple, set)) else got
    w = sp.nsimplify(want) if not isinstance(want, (list, tuple, set)) else want
    same = (sorted(map(sp.nsimplify, g)) == sorted(map(sp.nsimplify, w))
            if isinstance(g, (list, tuple)) else sp.simplify(g - w) == 0)
    if same:
        ok += 1
    else:
        bad.append(f"{label}: sympy={g}  page={w}")


def approx(label, got, want, tol=5e-3):
    global ok
    if abs(float(got) - float(want)) < tol:
        ok += 1
    else:
        bad.append(f"{label}: sympy={float(got):.6f}  page={want}")


# ============================================================ 01 - algebra ==
eq("01.1.2 (x^2-9)/(x+3)=2", sp.solve(sp.Eq((x**2 - 9) / (x + 3), 2), x), [5])
# domain of sqrt(x-4)/(x-7): x>=4 without 7
dom = sp.solveset(x - 4 >= 0, x, sp.S.Reals) - sp.FiniteSet(7)
eq("01.1.3 domain lower bound", dom.inf, 4)
assert 7 not in dom and 4 in dom and 8 in dom, "01.1.3 domain wrong"
ok += 1

# sqrt(3x+1)=x-1 : squaring gives 0 and 5, only 5 survives
raw = sp.solve(sp.Eq(3 * x + 1, (x - 1) ** 2), x)
eq("01.2.2 squared roots", raw, [0, 5])
eq("01.2.2 real solutions", sp.solve(sp.Eq(sp.sqrt(3 * x + 1), x - 1), x), [5])
eq("01.2.3 1/(x-1)+1/(x+1)=1",
   sp.solve(sp.Eq(1 / (x - 1) + 1 / (x + 1), 1), x), [1 - sp.sqrt(2), 1 + sp.sqrt(2)])
# -- 01.3.x  replaced 17.09.2026 - roots, absolute value, fractions and inequalities together --
# Checked as SETS, not only as lists of roots: most answers here are intervals, and an open
# end written as closed is exactly the mistake these exercises exist to teach.
RR = sp.S.Reals


def same_set(label, got, want):
    global ok
    if got == want:
        ok += 1
    else:
        bad.append(f"{label}: sympy={got}  page={want}")


# -- 01.3.1  f = sqrt(6-|x-1|) ---------------------------------------------------
f31 = sp.sqrt(6 - sp.Abs(x - 1))
same_set("01.3.1 domain", sp.solveset(6 - sp.Abs(x - 1) >= 0, x, RR), sp.Interval(-5, 7))
same_set("01.3.1 f=2", sp.solveset(sp.Eq(f31, 2), x, RR), sp.FiniteSet(-1, 3))
same_set("01.3.1 f>sqrt(5)", sp.solveset(f31 > sp.sqrt(5), x, RR), sp.Interval.open(0, 2))
eq("01.3.1 largest value sqrt(6) at x=1", f31.subs(x, 1), sp.sqrt(6))
for kv, count in [(-1, 0), (0, 2), (1, 2), (sp.sqrt(6), 1), (3, 0)]:
    eq(f"01.3.1 f=k={kv} has {count} solutions", len(sp.solveset(sp.Eq(f31, kv), x, RR)), count)
eq("01.3.1 k=1 gives x=1-(6-1), 1+(6-1)", sorted(sp.solveset(sp.Eq(f31, 1), x, RR)), [-4, 6])

# -- 01.3.2  r = sqrt((x^2-x-6)/(x^2-2x)) -----------------------------------------
E32 = (x**2 - x - 6) / (x**2 - 2 * x)
D32 = sp.solveset(E32 >= 0, x, RR)
same_set("01.3.2 domain", D32, sp.Union(sp.Interval(-sp.oo, -2), sp.Interval.open(0, 2),
                                        sp.Interval(3, sp.oo)))
eq("01.3.2 numerator factors", sp.expand((x - 3) * (x + 2)) - (x**2 - x - 6), 0)
same_set("01.3.2 r=1", sp.solveset(sp.Eq(E32, 1), x, RR), sp.FiniteSet(6))
eq("01.3.2 E-1", sp.simplify(E32 - 1 - (x - 6) / (x * (x - 2))), 0)
same_set("01.3.2 E<1 before the domain", sp.solveset(E32 < 1, x, RR),
         sp.Union(sp.Interval.open(-sp.oo, 0), sp.Interval.open(2, 6)))
same_set("01.3.2 r<1", sp.Intersection(D32, sp.solveset(E32 < 1, x, RR)),
         sp.Union(sp.Interval(-sp.oo, -2), sp.Interval.Ropen(3, 6)))
eq("01.3.2 E-2", sp.simplify(E32 - 2 + (x**2 - 3 * x + 6) / (x * (x - 2))), 0)
eq("01.3.2 x^2-3x+6 has discriminant 9-24", 3**2 - 4 * 6, -15)
same_set("01.3.2 r>=sqrt(2)", sp.Intersection(D32, sp.solveset(E32 >= 2, x, RR)),
         sp.Interval.open(0, 2))

# -- 01.3.3  g = x - 3sqrt(x) - 10, by t = sqrt(x) --------------------------------
g33 = x - 3 * sp.sqrt(x) - 10
eq("01.3.3 t^2-3t-10 factors", sp.expand((t - 5) * (t + 2)) - (t**2 - 3 * t - 10), 0)
same_set("01.3.3 g=0", sp.solveset(sp.Eq(g33, 0), x, RR), sp.FiniteSet(25))
eq("01.3.3 check at 25", g33.subs(x, 25), 0)
same_set("01.3.3 g<0", sp.solveset(g33 < 0, x, RR), sp.Interval.Ropen(0, 25))
same_set("01.3.3 domain of sqrt(g)", sp.solveset(g33 >= 0, x, RR), sp.Interval(25, sp.oo))
eq("01.3.3 smallest value", sp.minimum(g33, x, sp.Interval(0, sp.oo)), sp.Rational(-49, 4))
eq("01.3.3 at x=9/4", g33.subs(x, sp.Rational(9, 4)), sp.Rational(-49, 4))

# -- 01.3.4  f = sqrt(x^2-6x+9) + sqrt(x^2+2x+1) = |x-3| + |x+1| ------------------
# sympy's solveset mishandles sqrt((x-3)^2), so the equations are solved in the |.| form,
# and that form is checked against the root form point by point.
f34 = sp.Abs(x - 3) + sp.Abs(x + 1)
eq("01.3.4 two perfect squares", [sp.expand((x - 3)**2) - (x**2 - 6 * x + 9),
                                  sp.expand((x + 1)**2) - (x**2 + 2 * x + 1)], [0, 0])
for pt in (-3, -1, 0, 3, 5):
    eq(f"01.3.4 root form = abs form at {pt}",
       sp.sqrt(pt**2 - 6 * pt + 9) + sp.sqrt(pt**2 + 2 * pt + 1), f34.subs(x, pt))
# eq() sorts lists, and expressions in x cannot be sorted - one claim per branch
eq("01.3.4 branch x<-1", sp.expand((3 - x) + (-x - 1)), 2 - 2 * x)
eq("01.3.4 branch -1<=x<3", sp.expand((3 - x) + (x + 1)), 4)
eq("01.3.4 branch x>=3", sp.expand((x - 3) + (x + 1)), 2 * x - 2)
same_set("01.3.4 f=8", sp.solveset(sp.Eq(f34, 8), x, RR), sp.FiniteSet(-3, 5))
same_set("01.3.4 f=4", sp.solveset(sp.Eq(f34, 4), x, RR), sp.Interval(-1, 3))
same_set("01.3.4 f<6", sp.solveset(f34 < 6, x, RR), sp.Interval.open(-2, 4))

# -- 01.3.5  |(x+1)/(x-2)| >= 2 ---------------------------------------------------
A35 = (x + 1) / (x - 2)
same_set("01.3.5 |A|=2", sp.solveset(sp.Eq(sp.Abs(A35), 2), x, RR), sp.FiniteSet(1, 5))
eq("01.3.5 first branch", sp.simplify(A35 - 2 - (5 - x) / (x - 2)), 0)
eq("01.3.5 second branch", sp.simplify(A35 + 2 - (3 * x - 3) / (x - 2)), 0)
S35 = sp.Union(sp.Interval.Ropen(1, 2), sp.Interval.Lopen(2, 5))
same_set("01.3.5 |A|>=2", sp.solveset(sp.Abs(A35) >= 2, x, RR) - sp.FiniteSet(2), S35)
same_set("01.3.5 domain of p", sp.solveset(sp.Abs(A35) - 2 >= 0, x, RR) - sp.FiniteSet(2), S35)
assert 2 not in S35
ok += 1
same_set("01.3.5 domain of q", sp.solveset(2 - sp.Abs(A35) > 0, x, RR) - sp.FiniteSet(2),
         sp.Union(sp.Interval.open(-sp.oo, 1), sp.Interval.open(5, sp.oo)))

# -- 01.3.6  sqrt(x+7) against |x-5| ----------------------------------------------
eq("01.3.6 squared", sp.expand((x - 5)**2 - (x + 7)) - (x**2 - 11 * x + 18), 0)
same_set("01.3.6 f=0", sp.solveset(sp.Eq(sp.sqrt(x + 7), sp.Abs(x - 5)), x, RR), sp.FiniteSet(2, 9))
same_set("01.3.6 without the absolute value", sp.solveset(sp.Eq(sp.sqrt(x + 7), x - 5), x, RR),
         sp.FiniteSet(9))
same_set("01.3.6 f>0", sp.solveset(sp.sqrt(x + 7) > sp.Abs(x - 5), x, RR), sp.Interval.open(2, 9))
f36 = sp.sqrt(x + 7) - sp.Abs(x - 5)
eq("01.3.6 test points -7, 5, 18", [f36.subs(x, -7), f36.subs(x, 18)], [-12, -8])
eq("01.3.6 f(5)=sqrt(12)", f36.subs(x, 5), sp.sqrt(12))

# -- 01.3.7  sqrt(x) against y = x + m ---------------------------------------------
m37 = sp.symbols("m37", real=True)
same_set("01.3.7 m=0", sp.solveset(sp.Eq(sp.sqrt(x), x), x, RR), sp.FiniteSet(0, 1))
same_set("01.3.7 sqrt(x)>x", sp.solveset(sp.sqrt(x) > x, x, RR), sp.Interval.open(0, 1))
eq("01.3.7 quadratic", sp.expand((x + m37)**2 - x) - (x**2 + (2 * m37 - 1) * x + m37**2), 0)
eq("01.3.7 discriminant", sp.expand((2 * m37 - 1)**2 - 4 * m37**2), 1 - 4 * m37)
same_set("01.3.7 m=1/4", sp.solveset(sp.Eq(sp.sqrt(x), x + sp.Rational(1, 4)), x, RR),
         sp.FiniteSet(sp.Rational(1, 4)))
for mv, count in [(sp.Rational(1, 10), 2), (sp.Rational(1, 5), 2), (sp.Rational(1, 4), 1),
                  (sp.Rational(3, 10), 0)]:
    eq(f"01.3.7 m={mv} meets {count} times",
       len(sp.solveset(sp.Eq(sp.sqrt(x), x + mv), x, RR)), count)

# =========================================================== 02 - sequences ==
d, q = sp.symbols("d q")
# -- 02.1.1  an infinite sum with a negative ratio ------------------------------
q11 = sp.Rational(-6, 12)
eq("02.1.1 ratio, first pair", q11, sp.Rational(-1, 2))
eq("02.1.1 ratio, second pair", sp.Rational(3, -6), sp.Rational(-1, 2))
eq("02.1.1 the listed terms", [12 * q11**i for i in range(4)], [12, -6, 3, sp.Rational(-3, 2)])
assert abs(q11) < 1, "02.1.1 |q|<1 is what licenses the sum"
ok += 1
eq("02.1.1 infinite sum", 12 / (1 - q11), 8)

# -- 02.1.2  rising, falling or neither, read off a1 and q ----------------------
def trend(a1, ratio):
    """+1 rising, -1 falling, 0 neither: the sign of a_{n+1}-a_n over twenty steps."""
    signs = {sp.sign(a1 * ratio**i * (ratio - 1)) for i in range(20)}
    return signs.pop() if len(signs) == 1 else 0


eq("02.1.2 a terms", [-4 * 3**i for i in range(3)], [-4, -12, -36])
eq("02.1.2 a falls", trend(-4, 3), -1)
eq("02.1.2 b terms", [-4 * sp.Rational(1, 2) ** i for i in range(4)],
   [-4, -2, -1, sp.Rational(-1, 2)])
eq("02.1.2 b rises", trend(-4, sp.Rational(1, 2)), 1)
eq("02.1.2 c terms", [4 * (-3) ** i for i in range(3)], [4, -12, 36])
eq("02.1.2 c neither", trend(4, -3), 0)
eq("02.1.3 a5", 81 * sp.Rational(1, 3) ** 4, 1)
eq("02.1.3 S4", 81 * (1 - sp.Rational(1, 3) ** 4) / (1 - sp.Rational(1, 3)), 120)

# -- 02.2.2  a ratio that carries a parameter -----------------------------------
# The trap is the second question: S=-2 DOES solve, at x=8, where the ratio is 2 and
# there is no sum at all. So the convergence range is asserted as a set, and 8 outside it.
qx = (x - 2) / 3
conv = sp.solveset(sp.Abs(qx) < 1, x, sp.S.Reals)
assert conv == sp.Interval.open(-1, 5), conv
ok += 1
Sx = qx / (1 - qx)
eq("02.2.2 sum formula", sp.simplify(Sx - (x - 2) / (5 - x)), 0)
eq("02.2.2 S=2", sp.solve(sp.Eq(Sx, 2), x), [4])
eq("02.2.2 ratio at x=4", qx.subs(x, 4), sp.Rational(2, 3))
assert 4 in conv
ok += 1
eq("02.2.2 S=-2 solves the equation", sp.solve(sp.Eq(Sx, -2), x), [8])
eq("02.2.2 ratio at x=8", qx.subs(x, 8), 2)
assert 8 not in conv, "02.2.2 x=8 must fall outside the convergence range"
ok += 1
qq = sp.solve(sp.Eq(q**3, 8), q)
eq("02.2.3 q", [v for v in qq if v.is_real], [2])
eq("02.2.3 a1", sp.Rational(6, 2), 3)
eq("02.2.3 S6", 3 * (2**6 - 1) / (2 - 1), 189)

# -- 02.3.1  terms grouped in threes --------------------------------------------
A1, Q = sp.symbols("A1 Q")
kk = sp.Symbol("kk", integer=True, positive=True)
term = lambda m: A1 * Q ** (m - 1)
block = lambda m: term(3 * m - 2) + term(3 * m - 1) + term(3 * m)
eq("02.3.1 B_k factors", sp.simplify(block(kk) - term(3 * kk - 2) * (1 + Q + Q**2)), 0)
# sympy does not cancel Q**(3kk) against Q**(3kk-3) on its own; dividing both by the
# common power first leaves two plain polynomials in Q
unq = lambda e, p: sp.expand(sp.powsimp(sp.expand(e / Q**p)))
eq("02.3.1 ratio q^3", sp.cancel(unq(block(kk + 1), 3 * kk - 3) / unq(block(kk), 3 * kk - 3)), Q**3)
assert sp.solveset(1 + x + x**2 <= 0, x, sp.S.Reals) == sp.S.EmptySet, "02.3.1 1+q+q^2>0"
ok += 1
q31 = [v for v in sp.solve(sp.Eq(x**3, sp.Rational(-1, 8)), x) if v.is_real]
eq("02.3.1 q", q31, [sp.Rational(-1, 2)])
q31 = q31[0]
a31 = sp.solve(sp.Eq(A1 * (1 + q31 + q31**2), 12), A1)[0]
eq("02.3.1 a1", a31, 16)
seq31 = lambda m: a31 * q31 ** (m - 1)
B31 = lambda m: seq31(3 * m - 2) + seq31(3 * m - 1) + seq31(3 * m)
eq("02.3.1 B1", B31(1), 12)
eq("02.3.1 B2", B31(2), sp.Rational(-3, 2))
eq("02.3.1 8^4", 8**4, 4096)
eq("02.3.1 B5", B31(5), sp.Rational(3, 1024))
eq("02.3.1 only k=5 has that size",
   [m for m in range(1, 40) if abs(B31(m)) == sp.Rational(3, 1024)], [5])
assert sp.Rational(-3, 1024) not in [B31(m) for m in range(1, 40)], "02.3.1 -3/1024 is no term"
ok += 1
eq("02.3.1 sum of a", a31 / (1 - q31), sp.Rational(32, 3))
eq("02.3.1 sum of B", B31(1) / (1 - q31**3), sp.Rational(32, 3))

# -- 02.3.2  the sequence of steps a_{n+1}-a_n -----------------------------------
q32 = sp.solve(sp.Eq(64 * q**2 - 64 * q, -12), q)
eq("02.3.2 two ratios", q32, [sp.Rational(1, 4), sp.Rational(3, 4)])
eq("02.3.2 discriminant", 16**2 - 4 * 16 * 3, 64)
step = lambda m: term(m + 1) - term(m)
eq("02.3.2 d_n factors", sp.simplify(step(kk) - A1 * Q ** (kk - 1) * (Q - 1)), 0)
eq("02.3.2 d ratio", sp.cancel(unq(step(kk + 1), kk - 1) / unq(step(kk), kk - 1)), Q)
eq("02.3.2 d1", sp.simplify(step(1) - A1 * (Q - 1)), 0)
Ns = sp.Symbol("Ns", integer=True, positive=True)
eq("02.3.2 sum telescopes",
   sp.simplify(sp.summation(step(kk), (kk, 1, Ns)) - A1 * (Q**Ns - 1)), 0)
eq("02.3.2 q=1/4 gives n=3", [m for m in range(1, 60)
                              if 64 * sp.Rational(1, 4) ** m - 64 == -63], [3])
eq("02.3.2 q=3/4 gives no n", len([m for m in range(1, 200)
                                   if 64 * sp.Rational(3, 4) ** m - 64 == -63]), 0)
assert sp.Rational(3, 4) ** 14 > sp.Rational(1, 64) > sp.Rational(3, 4) ** 15
ok += 1
approx("02.3.2 (3/4)^14", sp.Rational(3, 4) ** 14, 0.0178, 5e-4)
approx("02.3.2 (3/4)^15", sp.Rational(3, 4) ** 15, 0.0134, 5e-4)
eq("02.3.2 d rises: d_{n+1}-d_n over q^{n-1}", unq(step(kk + 1) - step(kk), kk - 1), A1 * (Q - 1) ** 2)

qi = sp.solve(sp.Eq(18 / (1 - q), 27), q)[0]
eq("02.3.3 q", qi, sp.Rational(1, 3))
eq("02.3.3 a3", 18 * qi**2, 2)
eq("02.3.3 b ratio is 1/q", sp.simplify(1 / qi), 3)
assert abs(1 / qi) > 1, "02.3.3 the reciprocal sequence must diverge"
ok += 1
Sn3 = 27 * (1 - qi**n)
eq("02.3.3 S3 is exactly 26", Sn3.subs(n, 3), 26)
eq("02.3.3 smallest n over 26",
   min(i for i in range(1, 40) if Sn3.subs(n, i) > 26), 4)
eq("02.3.3 partial sum formula",
   sp.simplify(18 * (1 - qi**n) / (1 - qi) - Sn3), 0)

# =========================================================== 03 - induction ==
eq("03.1.2 odd sum", sp.simplify(sp.summation(2 * k - 1, (k, 1, n)) - n**2), 0)
eq("03.1.3 even sum", sp.simplify(sp.summation(2 * k, (k, 1, n)) - n * (n + 1)), 0)
# -- 03.2.1  (2k+1)/(k^2(k+1)^2) sums to 1-1/(n+1)^2 ----------------------------
# replaces the rung-2 exercise that was 35571 summer 2024 B q1a(1) word for word
i3m = sp.Symbol("i3m", positive=True)
eq("03.2.1 base n=1", sp.Rational(3, 4), 1 - sp.Rational(1, 4))
eq("03.2.1 n=2", sp.Rational(3, 4) + sp.Rational(5, 36), sp.Rational(8, 9))
for i3n in range(1, 11):
    eq(f"03.2.1 sum to {i3n}",
       sum(sp.Rational(2 * j + 1, j**2 * (j + 1) ** 2) for j in range(1, i3n + 1)),
       1 - sp.Rational(1, (i3n + 1) ** 2))
eq("03.2.1 step numerator", sp.expand((i3m + 2) ** 2 - (2 * i3m + 3)), sp.expand((i3m + 1) ** 2))
eq("03.2.1 step",
   sp.simplify(1 - 1 / (i3m + 1) ** 2 + (2 * i3m + 3) / ((i3m + 1) ** 2 * (i3m + 2) ** 2)
               - (1 - 1 / (i3m + 2) ** 2)), 0)
# -- 03.2.2  prod (1 - 1/(k+1)^2) = (n+2)/(2(n+1)) ------------------------------
eq("03.2.2 base n=1", 1 - sp.Rational(1, 4), sp.Rational(3, 2 * 2))
for i3n in range(1, 11):
    eq(f"03.2.2 product to {i3n}",
       sp.prod([1 - sp.Rational(1, (j + 1) ** 2) for j in range(1, i3n + 1)]),
       sp.Rational(i3n + 2, 2 * (i3n + 1)))
eq("03.2.2 difference of squares", sp.expand((i3m + 2) ** 2 - 1 - (i3m + 1) * (i3m + 3)), 0)
eq("03.2.2 step",
   sp.simplify((i3m + 2) / (2 * (i3m + 1)) * (1 - 1 / (i3m + 2) ** 2) - (i3m + 3) / (2 * (i3m + 2))), 0)
# -- 03.2.3  sum 1/(sqrt k + sqrt(k+1)) = sqrt(n+1) - 1 ----------------------------
eq("03.2.3 base n=1", 1 / (1 + sp.sqrt(2)), sp.sqrt(2) - 1)
eq("03.2.3 conjugate gives denominator 1",
   sp.expand((sp.sqrt(i3m + 2) + sp.sqrt(i3m + 1)) * (sp.sqrt(i3m + 2) - sp.sqrt(i3m + 1))), 1)
for i3n in range(1, 13):
    approx(f"03.2.3 sum to {i3n}",
           sum(1 / (sp.sqrt(j) + sp.sqrt(j + 1)) for j in range(1, i3n + 1)).evalf(30),
           (sp.sqrt(i3n + 1) - 1).evalf(30), 1e-12)
# -- 03.3.2  cubes, with the helper formula given, and n from the value -----------
eq("03.3.2 cubes",
   sp.simplify(sp.summation(k**3, (k, 1, n)) - (n * (n + 1) / 2) ** 2), 0)
eq("03.3.2 step factor",
   sp.expand((k * (k + 1) / 2) ** 2 + (k + 1) ** 3 - (k + 1) ** 2 / 4 * (k**2 + 4 * k + 4)), 0)
eq("03.3.2 3025 is 55^2", 55**2, 3025)
eq("03.3.2 n(n+1)/2=55", [s for s in sp.solve(sp.Eq(n * (n + 1) / 2, 55), n) if s > 0], [10])
eq("03.3.2 n^2+n-110 roots", sp.solve(n**2 + n - 110, n), [-11, 10])
eq("03.3.2 sum of cubes to 10", sum(j**3 for j in range(1, 11)), 3025)
# -- 03.3.3  2*3^(k-1)/((3^(k-1)+1)(3^k+1)) sums to 1/2 - 1/(3^n+1) ----------------
# replaces the recursion exercise: no paper among the 32 defines a sequence by recursion
i3p = sp.Symbol("i3p", positive=True)       # stands for 3^k
i3a = lambda j: sp.Rational(2 * 3 ** (j - 1), (3 ** (j - 1) + 1) * (3**j + 1))
eq("03.3.3 a1", i3a(1), sp.Rational(1, 4))
eq("03.3.3 a2", i3a(2), sp.Rational(6, 40))
eq("03.3.3 n=1", i3a(1), sp.Rational(1, 2) - sp.Rational(1, 4))
eq("03.3.3 n=2", i3a(1) + i3a(2), sp.Rational(2, 5))
eq("03.3.3 n=2 right side", sp.Rational(1, 2) - sp.Rational(1, 10), sp.Rational(2, 5))
for i3n in range(1, 11):
    eq(f"03.3.3 sum to {i3n}", sum(i3a(j) for j in range(1, i3n + 1)),
       sp.Rational(1, 2) - sp.Rational(1, 3**i3n + 1))
eq("03.3.3 step numerator", -(3 * i3p + 1) + 2 * i3p, -(i3p + 1))
eq("03.3.3 step",
   sp.simplify(sp.Rational(1, 2) - 1 / (i3p + 1) + 2 * i3p / ((i3p + 1) * (3 * i3p + 1))
               - (sp.Rational(1, 2) - 1 / (3 * i3p + 1))), 0)
eq("03.3.3 1/2 - 121/244", sp.Rational(1, 2) - sp.Rational(121, 244), sp.Rational(1, 244))
eq("03.3.3 3^5", 3**5, 243)
eq("03.3.3 n", [j for j in range(1, 30) if sum(i3a(i) for i in range(1, j + 1)) == sp.Rational(121, 244)], [5])

# ========================================================= 04 - probability ==
eq("04.1.2 two blacks", F(6, 10) ** 2, F(36, 100))
eq("04.1.3 dice sum 8",
   F(sum(1 for a in range(1, 7) for b in range(1, 7) if a + b == 8), 36), F(5, 36))
pd = F(7, 10) * F(2, 100) + F(3, 10) * F(5, 100)
eq("04.2.2 P(defective)", pd, F(29, 1000))
eq("04.2.3 P(B|defective)", (F(3, 10) * F(5, 100)) / pd, F(15, 29))
pc = F(55, 100) * F(30, 100) + F(45, 100) * F(20, 100)
eq("04.3.2 P(choir)", pc, F(255, 1000))
eq("04.3.2 P(boy|choir)", (F(45, 100) * F(20, 100)) / pc, F(6, 17))
approx("04.3.2 at least one", 1 - (1 - float(pc)) ** 4, 0.6919)
C = sp.binomial
eq("04.3.3 total", C(9, 3), 84)
eq("04.3.3 all red", sp.Rational(C(5, 3), C(9, 3)), sp.Rational(5, 42))
eq("04.3.3 exactly two red", sp.Rational(C(5, 2) * C(4, 1), C(9, 3)), sp.Rational(10, 21))
eq("04.3.3 conditional",
   sp.Rational(C(5, 2) * C(4, 1), C(9, 3) - C(5, 3)), sp.Rational(20, 37))
# 04.3.1 replaced 17.09.2026: free throws, stop right after the second hit
ps = sp.Symbol("ps")
ps_roots = sp.solve(sp.Eq(2 * ps * (1 - ps), sp.Rational(48, 100)), ps)
eq("04.3.1 roots of 2p(1-p)=0.48", ps_roots, [F(2, 5), F(3, 5)])
eq("04.3.1 same equation after p -> 1-p",
   sp.expand((2 * ps * (1 - ps)).subs(ps, 1 - ps) - 2 * ps * (1 - ps)), 0)
eq("04.3.1 condition p>1-p keeps", [s for s in ps_roots if s > 1 - s], [F(3, 5)])
hit = F(3, 5)


def stop_after(m, keep=lambda seq: True):
    """P(the second hit lands exactly on throw m, and `keep` holds), by listing every sequence."""
    from itertools import product
    tot = F(0)
    for seq in product((1, 0), repeat=m):
        if sum(seq) == 2 and seq[-1] == 1 and keep(seq):
            pr = F(1)
            for s in seq:
                pr *= hit if s else 1 - hit
            tot += pr
    return tot


eq("04.3.1 stop after 4", stop_after(4), F(1728, 10000))
eq("04.3.1 C(3,1) form", C(3, 1) * hit * (1 - hit) ** 2 * hit, F(1728, 10000))
eq("04.3.1 3*0.36*0.16", 3 * F(36, 100) * F(16, 100), F(1728, 10000))
eq("04.3.1 one order", hit ** 2 * (1 - hit) ** 2, F(576, 10000))
miss2 = stop_after(4, lambda seq: seq[1] == 0)
eq("04.3.1 missed 2nd and stopped after 4", miss2, 2 * F(576, 10000))
eq("04.3.1 2*0.0576", 2 * F(576, 10000), F(1152, 10000))
eq("04.3.1 conditional", miss2 / stop_after(4), F(2, 3))
# the answer does not depend on p: redo it with p as a symbol
ps_orders = [(1, 0, 0, 1), (0, 1, 0, 1), (0, 0, 1, 1)]
ps_pr = {o: sp.Mul(*[ps if s else 1 - ps for s in o]) for o in ps_orders}
eq("04.3.1 conditional for any p",
   sp.simplify(sum(v for o, v in ps_pr.items() if o[1] == 0) / sum(ps_pr.values())), F(2, 3))

# =========================================================== 05 - geometry ==
eq("05.1.2 inscribed angle", sp.Rational(80, 2), 40)
eq("05.1.3 angle on a diameter", sp.Rational(180, 2), 90)
eq("05.2.2 half chord", sp.Rational(12, 2), 6)
eq("05.2.2 chord distance", sp.sqrt(10**2 - 6**2), 8)
# 05.2.3 is built on the unit circle and measured, so the tangent-chord step itself is
# checked and not only the arithmetic after it: arcs PQ=100, QR=120, RP=140 degrees.
_g5 = sp.pi / 180
_P5, _Q5, _R5 = [sp.Matrix([sp.cos(a * _g5), sp.sin(a * _g5)]) for a in (-90, 10, 130)]
_ang5 = lambda u, v: sp.acos(u.dot(v) / (u.norm() * v.norm())) / _g5
_t5 = sp.Matrix([1, 0])   # the tangent at the lowest point of the circle is horizontal
approx("05.2.3 tangent with PQ", _ang5(_t5, _Q5 - _P5), 50)
approx("05.2.3 tangent with PR", _ang5(-_t5, _R5 - _P5), 70)
approx("05.2.3 angle PRQ", _ang5(_P5 - _R5, _Q5 - _R5), 50)
approx("05.2.3 angle PQR", _ang5(_P5 - _Q5, _R5 - _Q5), 70)
approx("05.2.3 angle QPR", _ang5(_Q5 - _P5, _R5 - _P5), 60)
eq("05.2.3 angle sum", 180 - 50 - 70, 60)
eq("05.2.3 straight angle at P", 50 + 60 + 70, 180)
eq("05.3.2 PD", sp.Rational(6 * 4, 3), 8)
pb = sp.solve(sp.Eq(6**2, 4 * sp.Symbol("PB")), sp.Symbol("PB"))[0]
eq("05.3.3 PB", pb, 9)
eq("05.3.3 AB", pb - 4, 5)

# ======================================================= 06 - trigonometry ==
eq("06.1.2 hypotenuse", sp.sqrt(5**2 + 12**2), 13)
eq("06.1.2 sin", sp.Rational(5, 13), sp.Rational(5, 13))
eq("06.1.3 area", sp.Rational(1, 2) * 8 * 6 * sp.sin(sp.rad(60)), 12 * sp.sqrt(3))
eq("06.1.3 c", sp.sqrt(64 + 36 - 2 * 8 * 6 * sp.cos(sp.rad(60))), 2 * sp.sqrt(13))
eq("06.2.2 b", 10 * sp.sin(sp.rad(60)) / sp.sin(sp.rad(45)), 5 * sp.sqrt(6))
ca = sp.Rational(9**2 + 8**2 - 7**2, 2 * 9 * 8)
eq("06.2.3 cos alpha", ca, sp.Rational(2, 3))
approx("06.2.3 alpha deg", sp.deg(sp.acos(ca)), 48.19)
sa = sp.solve(sp.Eq(sp.Rational(1, 2) * 10 * 8 * sp.Symbol("s"), 20), sp.Symbol("s"))[0]
eq("06.3.2 sin A", sa, sp.Rational(1, 2))
approx("06.3.2 BC at 30", sp.sqrt(164 - 160 * sp.cos(sp.rad(30))), 5.04, 0.01)
approx("06.3.2 BC at 150", sp.sqrt(164 - 160 * sp.cos(sp.rad(150))), 17.40, 0.01)
h_trap = 5 * sp.sin(sp.rad(60))
approx("06.3.3 height", h_trap, 4.330)
eq("06.3.3 height exact", h_trap, 5 * sp.sqrt(3) / 2)
run = 12 - 6 - 5 * sp.cos(sp.rad(60))
eq("06.3.3 horizontal run", run, sp.Rational(7, 2))
eq("06.3.3 BC", sp.sqrt(run**2 + h_trap**2), sp.sqrt(31))
eq("06.3.3 area", (12 + 6) / 2 * h_trap, 45 * sp.sqrt(3) / 2)

# ========================================================== 07 - derivative ==
# -- 07.1.1  x^3 - 3x, its type read off the sign of f' ------------------------
g71 = x**3 - 3 * x
eq("07.1.1 f' factors", sp.expand(sp.diff(g71, x) - 3 * (x - 1) * (x + 1)), 0)
eq("07.1.1 critical", sp.solve(sp.diff(g71, x), x), [-1, 1])
eq("07.1.1 f(-1)", g71.subs(x, -1), 2)
eq("07.1.1 f(1)", g71.subs(x, 1), -2)
eq("07.1.1 f' > 0 left of -1", sp.sign(sp.diff(g71, x).subs(x, -2)), 1)
eq("07.1.1 f' < 0 between", sp.sign(sp.diff(g71, x).subs(x, 0)), -1)
eq("07.1.1 f' > 0 right of 1", sp.sign(sp.diff(g71, x).subs(x, 2)), 1)
f = 3 * x**4 - 2 * x**2 + 7
eq("07.1.2 f'", sp.diff(f, x), 12 * x**3 - 4 * x)
eq("07.1.2 f'(1)", sp.diff(f, x).subs(x, 1), 8)
f = x**2 - 6 * x + 5
eq("07.1.3 critical", sp.solve(sp.diff(f, x), x), [3])
eq("07.1.3 value", f.subs(x, 3), -4)
eq("07.1.3 f' < 0 left of 3", sp.sign(sp.diff(f, x).subs(x, 2)), -1)
eq("07.1.3 f' > 0 right of 3", sp.sign(sp.diff(f, x).subs(x, 4)), 1)
f = x**3 - 3 * x**2 - 9 * x + 5
eq("07.2.2 critical", sp.solve(sp.diff(f, x), x), [-1, 3])
eq("07.2.2 f(-1)", f.subs(x, -1), 10)
eq("07.2.2 f(3)", f.subs(x, 3), -22)
f = x / (x**2 + 1)
eq("07.2.3 f'", sp.simplify(sp.diff(f, x) - (1 - x**2) / (x**2 + 1) ** 2), 0)
eq("07.2.3 critical", sp.solve(sp.diff(f, x), x), [-1, 1])
eq("07.2.3 f(1)", f.subs(x, 1), sp.Rational(1, 2))
eq("07.2.3 limit", sp.limit(f, x, sp.oo), 0)
f = (x**2 - 4) / (x**2 - 1)
eq("07.3.2 f'", sp.simplify(sp.diff(f, x) - 6 * x / (x**2 - 1) ** 2), 0)
eq("07.3.2 critical", sp.solve(sp.diff(f, x), x), [0])
eq("07.3.2 f(0)", f.subs(x, 0), 4)
eq("07.3.2 x-intercepts", sp.solve(sp.Eq(f, 0), x), [-2, 2])
eq("07.3.2 horizontal asymptote", sp.limit(f, x, sp.oo), 1)
# both vertical asymptotes are real: the numerator does not vanish where the denominator does
eq("07.3.2 numerator at x=1", (x**2 - 4).subs(x, 1), -3)
eq("07.3.2 numerator at x=-1", (x**2 - 4).subs(x, -1), -3)
eq("07.3.2 min, not max", sp.sign(sp.diff(f, x).subs(x, sp.Rational(1, 2))), 1)
eq("07.3.2 decreasing left of 0", sp.sign(sp.diff(f, x).subs(x, sp.Rational(-1, 2))), -1)
f = sp.sqrt(x) * (x - 6)
eq("07.3.3 f'", sp.simplify(sp.diff(f, x) - (3 * x - 6) / (2 * sp.sqrt(x))), 0)
eq("07.3.3 critical", [s for s in sp.solve(sp.diff(f, x), x) if s.is_real], [2])
eq("07.3.3 f(2)", sp.simplify(f.subs(x, 2)), -4 * sp.sqrt(2))
# the endpoint x=0 is a maximum: f(0)=0 and f decreases right of it
eq("07.3.3 f(0)", f.subs(x, 0), 0)
eq("07.3.3 decreasing right of 0", sp.sign(sp.diff(f, x).subs(x, 1)), -1)
eq("07.3.3 roots", sp.solve(f, x), [0, 6])

# -- 07.3.1  f(x) = (2x - a)/(x^2 - 4) ---------------------------------------
a71 = sp.Symbol("a", real=True)
fa71 = (2 * x - a71) / (x**2 - 4)
eq("07.3.1 numerator of f'",
   sp.expand(sp.simplify(sp.diff(fa71, x) * (x**2 - 4) ** 2) - (-2 * x**2 + 2 * a71 * x - 8)), 0)
eq("07.3.1 f'(1)=0 gives a", sp.solve(sp.diff(fa71, x).subs(x, 1), a71), [5])
f31 = fa71.subs(a71, 5)
eq("07.3.1 numerator at a=5", sp.expand(-2 * x**2 + 10 * x - 8 + 2 * (x - 1) * (x - 4)), 0)
assert [sp.sign(sp.diff(f31, x).subs(x, v)) for v in (0, sp.Rational(3, 2))] == [-1, 1], \
    "07.3.1 x=1 is not a sign change of f'"
ok += 1
eq("07.3.1 vertical asymptotes", sp.solve(x**2 - 4, x), [-2, 2])
eq("07.3.1 numerator at 2", (2 * x - 5).subs(x, 2), -1)
eq("07.3.1 numerator at -2", (2 * x - 5).subs(x, -2), -9)
# eq() subtracts, and oo - oo is nan, so the one-sided infinite limits are asserted
for pt, side, want in ((2, "-", sp.oo), (2, "+", -sp.oo), (-2, "-", -sp.oo), (-2, "+", sp.oo)):
    assert sp.limit(f31, x, pt, side) == want, f"07.3.1 limit at {pt}{side}"
    ok += 1
eq("07.3.1 horizontal asymptote at +oo", sp.limit(f31, x, sp.oo), 0)
eq("07.3.1 horizontal asymptote at -oo", sp.limit(f31, x, -sp.oo), 0)
eq("07.3.1 critical", sp.solve(sp.diff(f31, x), x), [1, 4])
eq("07.3.1 f(1)", f31.subs(x, 1), 1)
eq("07.3.1 f(4)", f31.subs(x, 4), sp.Rational(1, 4))
for v, sgn in ((-3, -1), (0, -1), (sp.Rational(3, 2), 1), (3, 1), (5, -1)):
    eq(f"07.3.1 sign of f' at {v}", sp.sign(sp.diff(f31, x).subs(x, v)), sgn)
eq("07.3.1 x-intercept", sp.solve(f31, x), [sp.Rational(5, 2)])
eq("07.3.1 y-intercept", f31.subs(x, 0), sp.Rational(5, 4))
eq("07.3.1 f=k as a quadratic",
   sp.expand((2 * x - 5) - k * (x**2 - 4) + (k * x**2 - 2 * x + 5 - 4 * k)), 0)
eq("07.3.1 discriminant", sp.factor(4 - 4 * k * (5 - 4 * k)), 4 * (k - 1) * (4 * k - 1))
eq("07.3.1 x=2 never solves it", (k * x**2 - 2 * x + 5 - 4 * k).subs(x, 2), 1)
eq("07.3.1 x=-2 never solves it", (k * x**2 - 2 * x + 5 - 4 * k).subs(x, -2), 9)
for kv, count in ((-1, 2), (0, 1), (sp.Rational(1, 8), 2), (sp.Rational(1, 4), 1),
                  (sp.Rational(1, 2), 0), (1, 1), (2, 2)):
    eq(f"07.3.1 f(x)={kv} has {count} solutions",
       len([s for s in sp.solve(sp.Eq(f31, kv), x) if s.is_real]), count)

# ======================================================= 08 - trig functions ==
eq("08.1.2 derivative",
   sp.diff(sp.sin(3 * x) + sp.cos(2 * x), x), 3 * sp.cos(3 * x) - 2 * sp.sin(2 * x))
eq("08.1.3 derivative", sp.diff(x * sp.sin(x), x), sp.sin(x) + x * sp.cos(x))
# 08.2.2  sin^2 x + sqrt3 sin x cos x on -pi/2 < x < pi/2: f' = sin 2x + sqrt3 cos 2x, tan 2x = -sqrt3
f = sp.sin(x) ** 2 + sp.sqrt(3) * sp.sin(x) * sp.cos(x)
fp = sp.diff(f, x)
eq("08.2.2 f' in double angles", sp.simplify(fp - (sp.sin(2 * x) + sp.sqrt(3) * sp.cos(2 * x))), 0)
# where cos 2x = 0, sin 2x = +-1 and f' does not vanish: the permission slip for dividing
eq("08.2.2 f' where cos 2x = 0", [sp.simplify(fp.subs(x, v)) for v in (-sp.pi / 4, sp.pi / 4)], [-1, 1])
fam = [-sp.pi / 6 + sp.pi * j / 2 for j in range(-3, 5)]
eq("08.2.2 family members in the interval",
   [v for v in fam if -sp.pi / 2 < v < sp.pi / 2], [-sp.pi / 6, sp.pi / 3])
eq("08.2.2 k=-1 and k=2", [-sp.pi / 6 - sp.pi / 2, -sp.pi / 6 + sp.pi], [-2 * sp.pi / 3, 5 * sp.pi / 6])
eq("08.2.2 tan 2x at both", [sp.tan(2 * v) for v in (-sp.pi / 6, sp.pi / 3)], [-sp.sqrt(3), -sp.sqrt(3)])
for v in (-sp.pi / 6, sp.pi / 3):
    eq(f"08.2.2 f'({v})=0", sp.simplify(fp.subs(x, v)), 0)
gp = sp.lambdify(x, fp, "math")
lo, hi = -float(sp.pi) / 2, float(sp.pi) / 2
grid = [lo + i * (hi - lo) / 100000 for i in range(100001)]
eq("08.2.2 no other critical points", sum(1 for a, b in zip(grid, grid[1:]) if gp(a) * gp(b) <= 0), 2)
# sign table: the bounds in decimals, then one round test number inside each interval
approx("08.2.2 -pi/2", -sp.pi / 2, -1.57, 0.01)
approx("08.2.2 -pi/6", -sp.pi / 6, -0.52, 0.01)
approx("08.2.2 pi/3", sp.pi / 3, 1.05, 0.01)
approx("08.2.2 pi/2", sp.pi / 2, 1.57, 0.01)
assert -sp.pi / 2 < -1 < -sp.pi / 6 < 0 < sp.pi / 3 < sp.Rational(13, 10) < sp.pi / 2, "08.2.2 test points"
ok += 1
approx("08.2.2 f'(-1)", fp.subs(x, -1), -1.63, 0.01)
eq("08.2.2 f'(0)", fp.subs(x, 0), sp.sqrt(3))
approx("08.2.2 f'(1.3)", fp.subs(x, sp.Rational(13, 10)), -0.97, 0.01)
eq("08.2.2 min value", sp.simplify(f.subs(x, -sp.pi / 6)), sp.Rational(-1, 2))
eq("08.2.2 max value", sp.simplify(f.subs(x, sp.pi / 3)), sp.Rational(3, 2))
# solveset over an interval silently drops the two sin(x) = -1/2 roots here, so this
# is checked the honest way instead: each claimed root really is a root, and a numeric
# sweep finds no others in the interval.
claimed = [sp.pi / 2, 7 * sp.pi / 6, 11 * sp.pi / 6]
expr = 2 * sp.sin(x) ** 2 - sp.sin(x) - 1
for v in claimed:
    eq(f"08.2.3 root {v}", sp.simplify(expr.subs(x, v)), 0)
g = sp.lambdify(x, expr, "math")
grid = [i * float(2 * sp.pi) / 200000 for i in range(200001)]
found = {round(a, 2) for a, b in zip(grid, grid[1:])
         if g(a) == 0 or g(a) * g(b) < 0}
eq("08.2.3 no other roots in the interval",
   len(found), len({round(float(v), 2) for v in claimed}))
f = sp.sin(x) * sp.cos(x)
eq("08.3.2 identity", sp.simplify(f - sp.sin(2 * x) / 2), 0)
crit = sorted(sp.solveset(sp.diff(f, x), x, sp.Interval(0, sp.pi)))
eq("08.3.2 critical", crit, [sp.pi / 4, 3 * sp.pi / 4])
eq("08.3.2 max", f.subs(x, sp.pi / 4), sp.Rational(1, 2))
eq("08.3.2 min", f.subs(x, 3 * sp.pi / 4), sp.Rational(-1, 2))
eq("08.3.2 ends", [f.subs(x, 0), sp.simplify(f.subs(x, sp.pi))], [0, 0])
f = 2 * sp.cos(x) - x
crit = sorted(sp.solveset(sp.diff(f, x), x, sp.Interval(0, 2 * sp.pi)))
eq("08.3.3 critical", crit, [7 * sp.pi / 6, 11 * sp.pi / 6])
# 08.3.3 b: the type comes from the sign table of f', one round number in each interval
assert 1 < 7 * sp.pi / 6 < 5 < 11 * sp.pi / 6 < 6 < 2 * sp.pi, "08.3.3 test points"
ok += 1
approx("08.3.3 7pi/6", 7 * sp.pi / 6, 3.67, 0.01)
approx("08.3.3 11pi/6", 11 * sp.pi / 6, 5.76, 0.01)
approx("08.3.3 2pi", 2 * sp.pi, 6.28, 0.01)
approx("08.3.3 f'(1)", sp.diff(f, x).subs(x, 1), -2.68, 0.01)
approx("08.3.3 f'(5)", sp.diff(f, x).subs(x, 5), 0.92, 0.01)
approx("08.3.3 f'(6)", sp.diff(f, x).subs(x, 6), -0.44, 0.01)
vals = {0: f.subs(x, 0), 1: f.subs(x, 2 * sp.pi),
        2: f.subs(x, 7 * sp.pi / 6), 3: f.subs(x, 11 * sp.pi / 6)}
eq("08.3.3 f(0)", vals[0], 2)
approx("08.3.3 f(2pi)", vals[1], -4.283)
approx("08.3.3 min value", vals[2], -5.397)
approx("08.3.3 local max value", vals[3], -4.028)
assert max(float(v) for v in vals.values()) == float(vals[0]), "08.3.3 max is not the endpoint"
ok += 1

# ============================================================ 09 - extremum ==
# 09.1.1  triangle OAB under f(x) = 12 - x^2
S = t * (12 - t**2) / 2
eq("09.1.1 domain end", [v for v in sp.solve(12 - t**2, t) if v > 0], [2 * sp.sqrt(3)])
eq("09.1.1 critical in the domain", [v for v in sp.solve(sp.diff(S, t), t) if v > 0], [2])
eq("09.1.1 A", 12 - 2**2, 8)
eq("09.1.1 max area", S.subs(t, 2), 8)
eq("09.1.1 rising left", sp.sign(sp.diff(S, t).subs(t, 1)), 1)
eq("09.1.1 falling right", sp.sign(sp.diff(S, t).subs(t, 3)), -1)
assert 3 < 2 * sp.sqrt(3), "09.1.1 the test point 3 must be inside the domain"
ok += 1
# 09.1.2  right triangle, hypotenuse 10, angle x
S = 10 * sp.sin(x) * 10 * sp.cos(x) / 2
eq("09.1.2 area is 25 sin 2x", sp.simplify(S - 25 * sp.sin(2 * x)), 0)
eq("09.1.2 critical", sorted(sp.solveset(sp.diff(S, x), x, sp.Interval.open(0, sp.pi / 2))), [sp.pi / 4])
eq("09.1.2 legs", 10 * sp.sin(sp.pi / 4), 5 * sp.sqrt(2))
eq("09.1.2 max area", S.subs(x, sp.pi / 4), 25)
eq("09.1.2 rising left", sp.sign(sp.diff(S, x).subs(x, sp.pi / 6)), 1)
eq("09.1.2 falling right", sp.sign(sp.diff(S, x).subs(x, sp.pi / 3)), -1)
S = x * (20 - x)
eq("09.1.3 side", sp.solve(sp.diff(S, x), x), [10])
eq("09.1.3 area", S.subs(x, 10), 100)
# 09.2.1  rectangle cut off the axes by A(t, 9/(t+2))
P = 2 * t + 18 / (t + 2)
eq("09.2.1 roots of P'", sp.solve(sp.diff(P, t), t), [-5, 1])
eq("09.2.1 A", sp.Rational(9, 1 + 2), 3)
eq("09.2.1 min perimeter", P.subs(t, 1), 8)
eq("09.2.1 falling left", sp.sign(sp.diff(P, t).subs(t, sp.Rational(1, 2))), -1)
eq("09.2.1 rising right", sp.sign(sp.diff(P, t).subs(t, 2)), 1)
# 09.2.2  a line through M(2,3) cutting a triangle off the positive axes
m9 = sp.Symbol("m9", real=True)
xa = sp.solve(sp.Eq(0 - 3, m9 * (x - 2)), x)[0]
yb = 3 + m9 * (0 - 2)
eq("09.2.2 A", sp.simplify(xa - (2 - 3 / m9)), 0)
eq("09.2.2 B", yb, 3 - 2 * m9)
both = (sp.solveset(2 - 3 / m9 > 0, m9, sp.S.Reals)
        .intersect(sp.solveset(3 - 2 * m9 > 0, m9, sp.S.Reals)))
assert both == sp.Interval.open(-sp.oo, 0), both
ok += 1
S = sp.expand(xa * yb / 2)
eq("09.2.2 area", sp.simplify(S - (6 - 2 * m9 - sp.Rational(9, 2) / m9)), 0)
eq("09.2.2 roots of S'", sp.solve(sp.diff(S, m9), m9), [sp.Rational(-3, 2), sp.Rational(3, 2)])
eq("09.2.2 min area", S.subs(m9, sp.Rational(-3, 2)), 12)
eq("09.2.2 A at the minimum", xa.subs(m9, sp.Rational(-3, 2)), 4)
eq("09.2.2 B at the minimum", yb.subs(m9, sp.Rational(-3, 2)), 6)
eq("09.2.2 falling left", sp.sign(sp.diff(S, m9).subs(m9, -2)), -1)
eq("09.2.2 rising right", sp.sign(sp.diff(S, m9).subs(m9, -1)), 1)
# 09.2.3  P on AB, Q on BC of a 7x3 rectangle, AP = BQ = x
D = (7 - x) ** 2 + x**2
eq("09.2.3 expanded", sp.expand(D), 2 * x**2 - 14 * x + 49)
eq("09.2.3 critical", sp.solve(sp.diff(D, x), x), [sp.Rational(7, 2)])
assert sp.Rational(7, 2) > 3, "09.2.3 the critical point must fall outside 0<=x<=3"
assert sp.maximum(sp.diff(D, x), x, sp.Interval(0, 3)) < 0, "09.2.3 D' must be negative on the domain"
ok += 2
eq("09.2.3 D(3)", D.subs(x, 3), 25)
eq("09.2.3 min over the domain", sp.minimum(D, x, sp.Interval(0, 3)), 25)
eq("09.2.3 PQ", sp.sqrt(D.subs(x, 3)), 5)
eq("09.2.3 the other end", sp.sqrt(D.subs(x, 0)), 7)
# 09.3.1  the tangent to 12/x (base page exercise; its answers were rewritten 17.09.2026)
fx = 12 / x
tl = fx.subs(x, t) + sp.diff(fx, x).subs(x, t) * (x - t)
eq("09.3.1 slope", sp.diff(fx, x).subs(x, t), -12 / t**2)
eq("09.3.1 tangent", sp.simplify(tl - (-12 * x / t**2 + 24 / t)), 0)
eq("09.3.1 P", sp.solve(tl, x), [2 * t])
eq("09.3.1 Q", sp.simplify(tl.subs(x, 0) - 24 / t), 0)
eq("09.3.1 area is 24 for every t", sp.simplify(sp.Rational(1, 2) * 2 * t * (24 / t)), 24)
PQ2 = (2 * t) ** 2 + (24 / t) ** 2
eq("09.3.1 derivative of PQ^2", sp.simplify(sp.diff(PQ2, t) - (8 * t - 1152 / t**3)), 0)
eq("09.3.1 positive critical", [v for v in sp.solve(sp.diff(PQ2, t), t) if v > 0], [2 * sp.sqrt(3)])
eq("09.3.1 PQ^2 at the minimum", PQ2.subs(t, 2 * sp.sqrt(3)), 96)
eq("09.3.1 min PQ", sp.sqrt(PQ2.subs(t, 2 * sp.sqrt(3))), 4 * sp.sqrt(6))
eq("09.3.1 falling left", sp.sign(sp.diff(PQ2, t).subs(t, 3)), -1)
eq("09.3.1 rising right", sp.sign(sp.diff(PQ2, t).subs(t, 4)), 1)
# 09.3.2  isosceles triangle inscribed in a circle of radius 6, base angle x
AB9 = 2 * 6 * sp.sin(x)
BC9 = 2 * 6 * sp.sin(sp.pi - 2 * x)
eq("09.3.2 BC", sp.simplify(BC9 - 12 * sp.sin(2 * x)), 0)
S = sp.Rational(1, 2) * AB9 * AB9 * sp.sin(sp.pi - 2 * x)
eq("09.3.2 area", sp.simplify(sp.expand_trig(S - 144 * sp.sin(x) ** 3 * sp.cos(x))), 0)
eq("09.3.2 derivative", sp.simplify(sp.expand_trig(
    sp.diff(S, x) - 144 * (3 * sp.sin(x) ** 2 * sp.cos(x) ** 2 - sp.sin(x) ** 4))), 0)
eq("09.3.2 derivative factors", sp.simplify(
    144 * (3 * sp.sin(x) ** 2 * sp.cos(x) ** 2 - sp.sin(x) ** 4)
    - 144 * sp.sin(x) ** 2 * (4 * sp.cos(x) ** 2 - 1)), 0)
eq("09.3.2 critical", sorted(sp.solveset(4 * sp.cos(x) ** 2 - 1, x, sp.Interval.open(0, sp.pi / 2))),
   [sp.pi / 3])
eq("09.3.2 rising left", sp.sign(sp.diff(S, x).subs(x, sp.pi / 4)), 1)
eq("09.3.2 falling right", sp.sign(sp.diff(S, x).subs(x, 5 * sp.pi / 12)), -1)
eq("09.3.2 max area", sp.simplify(S.subs(x, sp.pi / 3)), 27 * sp.sqrt(3))
approx("09.3.2 max area decimal", S.subs(x, sp.pi / 3), 46.77, 0.01)
eq("09.3.2 equilateral", [sp.simplify(AB9.subs(x, sp.pi / 3)), sp.simplify(BC9.subs(x, sp.pi / 3))],
   [6 * sp.sqrt(3), 6 * sp.sqrt(3)])
A = 2 * x * sp.sqrt(R**2 - x**2)
crit = sp.solve(sp.diff(A, x), x)
assert any(sp.simplify(c - R / sp.sqrt(2)) == 0 for c in crit), "09.3.3 critical x wrong"
ok += 1
eq("09.3.3 area", sp.simplify(A.subs(x, R / sp.sqrt(2))), R**2)

# ============================================================ 10 - integral ==
F12 = sp.integrate(6 / x**2, x)
eq("10.1.2 antiderivative", sp.simplify(F12 - (-6 / x)), 0)
eq("10.1.2 upper", F12.subs(x, 3), -2)
eq("10.1.2 lower", F12.subs(x, 1), -6)
eq("10.1.2 definite", sp.integrate(6 / x**2, (x, 1, 3)), 4)
Fx = sp.integrate(4 * x**3 - 1, x)
C = sp.solve(sp.Eq(Fx.subs(x, 1) + sp.Symbol("C"), 3), sp.Symbol("C"))[0]
eq("10.1.3 constant", C, 3)
eq("10.1.3 F", sp.simplify(Fx + C - (x**4 - x + 3)), 0)
eq("10.2.2 roots", sp.solve(6 * x - 2 * x**2, x), [0, 3])
eq("10.2.2 above the axis", (6 * x - 2 * x**2).subs(x, 1), 4)
eq("10.2.2 antiderivative", sp.simplify(sp.integrate(6 * x - 2 * x**2, x) - (3 * x**2 - 2 * x**3 / 3)), 0)
eq("10.2.2 area", sp.integrate(6 * x - 2 * x**2, (x, 0, 3)), 9)
f23 = x**2 - 4 * x + 3
F23 = sp.integrate(f23, x)
eq("10.2.3 factored", sp.expand((x - 1) * (x - 3) - f23), 0)
eq("10.2.3 roots", sp.solve(f23, x), [1, 3])
eq("10.2.3 below the axis right of 1", f23.subs(x, sp.Rational(3, 2)), sp.Rational(-3, 4))
eq("10.2.3 above the axis left of 1", sp.sign(f23.subs(x, sp.Rational(1, 2))), 1)
eq("10.2.3 antiderivative", sp.simplify(F23 - (x**3 / 3 - 2 * x**2 + 3 * x)), 0)
eq("10.2.3 F(0)", F23.subs(x, 0), 0)
eq("10.2.3 F(1)", F23.subs(x, 1), sp.Rational(4, 3))
eq("10.2.3 F(2)", F23.subs(x, 2), sp.Rational(2, 3))
eq("10.2.3 left piece", sp.integrate(f23, (x, 0, 1)), sp.Rational(4, 3))
eq("10.2.3 right piece", sp.integrate(f23, (x, 1, 2)), sp.Rational(-2, 3))
eq("10.2.3 area", abs(sp.integrate(f23, (x, 0, 1))) + abs(sp.integrate(f23, (x, 1, 2))), 2)
approx("10.2.3 area numerically", sp.Integral(sp.Abs(f23), (x, 0, 2)).evalf(), 2)
eq("10.2.3 signed integral", sp.integrate(f23, (x, 0, 2)), sp.Rational(2, 3))
eq("10.3.2 intersections", sp.solve(sp.Eq(x**2, 32 - x**2), x), [-4, 4])
eq("10.3.2 antiderivative at 4", (32 * x - sp.Rational(2, 3) * x**3).subs(x, 4), sp.Rational(256, 3))
eq("10.3.2 area", sp.integrate(32 - 2 * x**2, (x, -4, 4)), sp.Rational(512, 3))
eq("10.3.2 lower antiderivative at 4", (16 * x - x**3 / 3).subs(x, 4), sp.Rational(128, 3))
eq("10.3.2 lower part", sp.integrate(16 - x**2, (x, -4, 4)), sp.Rational(256, 3))
eq("10.3.2 upper part", sp.integrate((32 - x**2) - 16, (x, -4, 4)), sp.Rational(256, 3))
eq("10.3.2 is half", sp.Rational(256, 3) * 2, sp.Rational(512, 3))
f = x**3 - 4 * x
eq("10.3.3 roots", sp.solve(f, x), [-2, 0, 2])
eq("10.3.3 signed integral", sp.integrate(f, (x, -2, 2)), 0)
eq("10.3.3 left piece", sp.integrate(f, (x, -2, 0)), 4)
eq("10.3.3 right piece", sp.integrate(f, (x, 0, 2)), -4)
eq("10.3.3 area", abs(sp.integrate(f, (x, -2, 0))) + abs(sp.integrate(f, (x, 0, 2))), 8)

# ------------------------------------------------------------------ report --
print(f"checked {ok + len(bad)} claims: {ok} ok, {len(bad)} wrong")
for line in bad:
    print("  MISMATCH", line)
raise SystemExit(1 if bad else 0)
