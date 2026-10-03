from manim import *

HEB_FONT = "DejaVu Sans"

def caption(text):
    t = Text(text, font=HEB_FONT, font_size=30, color=WHITE)
    max_w = config.frame_width - 1.0
    if t.width > max_w:
        t.scale_to_fit_width(max_w)
    return t.to_edge(DOWN, buff=0.4)

class ThinkingProcessCaptioned(Scene):
    def construct(self):
        title = MathTex(r"f(x) = |x-3| + |x+1|", font_size=44).to_edge(UP)
        self.play(Write(title))
        self.wait(0.4)

        c0 = caption("כדי לפתוח ערך מוחלט, בודקים את הסימן של כל ביטוי בכל תחום")
        self.play(Write(c0))
        self.wait(3.4)
        self.play(FadeOut(c0))

        nl = NumberLine(x_range=[-4, 6, 1], length=9, include_numbers=True, font_size=24,
                         numbers_to_exclude=[-1, 3])
        nl.move_to(ORIGIN + UP * 0.3)
        self.play(Create(nl))

        dot_m1 = Dot(nl.n2p(-1), color=YELLOW)
        dot_3 = Dot(nl.n2p(3), color=YELLOW)
        lab_m1 = MathTex("-1", font_size=26, color=YELLOW).next_to(dot_m1, DOWN, buff=0.15)
        lab_3 = MathTex("3", font_size=26, color=YELLOW).next_to(dot_3, DOWN, buff=0.15)
        self.play(FadeIn(dot_m1), FadeIn(dot_3), Write(lab_m1), Write(lab_3))
        self.wait(0.3)

        r_labels = VGroup(
            MathTex(r"x<-1", font_size=32, color="#00FFB3").move_to(nl.n2p(-2.5) + UP * 0.7),
            MathTex(r"-1\le x<3", font_size=32, color="#00BFFF").move_to(nl.n2p(1) + UP * 0.7),
            MathTex(r"x\ge 3", font_size=32, color="#FFB300").move_to(nl.n2p(4.5) + UP * 0.7),
        )
        self.play(Write(r_labels))

        c1 = caption("שתי נקודות האפס, 1- ו-3, מחלקות את הציר לשלושה תחומים")
        self.play(Write(c1))
        self.wait(4.5)
        self.play(FadeOut(c1))

        self.play(FadeOut(nl), FadeOut(dot_m1), FadeOut(dot_3), FadeOut(lab_m1), FadeOut(lab_3), FadeOut(r_labels))
        self.wait(0.2)

        conditions = [r"x<-1", r"-1\le x<3", r"x\ge 3"]
        signs = [
            r"x-3<0,\ \ x+1<0",
            r"x-3<0,\ \ x+1\ge 0",
            r"x-3\ge 0,\ \ x+1\ge 0",
        ]
        opens = [
            r"|x-3|=-(x-3),\ \ |x+1|=-(x+1)",
            r"|x-3|=-(x-3),\ \ |x+1|=x+1",
            r"|x-3|=x-3,\ \ |x+1|=x+1",
        ]
        finals = [r"f(x)=-2x+2", r"f(x)=4", r"f(x)=2x-2"]
        colors = ["#00FFB3", "#00BFFF", "#FFB300"]
        region_captions = [
            "בתחום הזה שני הביטויים שליליים - מורידים ערך מוחלט עם מינוס",
            "כאן x פחות 3 שלילי אבל x פלוס 1 כבר לא - כל אחד נפתח לפי הסימן שלו",
            "כאן שני הביטויים חיוביים - אין צורך במינוס בכלל",
        ]

        for i in range(3):
            cap = caption(region_captions[i])
            self.play(Write(cap))

            cond = MathTex(conditions[i], font_size=32, color=colors[i]).move_to(UP * 1.9)
            self.play(Write(cond))
            self.wait(0.3)

            sign = MathTex(r"\Downarrow", font_size=28).next_to(cond, DOWN, buff=0.2)
            sign_txt = MathTex(signs[i], font_size=30, color=colors[i]).next_to(sign, DOWN, buff=0.2)
            self.play(Write(sign), Write(sign_txt))
            self.wait(0.6)

            arrow2 = MathTex(r"\Downarrow", font_size=28).next_to(sign_txt, DOWN, buff=0.2)
            open_txt = MathTex(opens[i], font_size=28, color=colors[i]).next_to(arrow2, DOWN, buff=0.2)
            self.play(Write(arrow2), Write(open_txt))
            self.wait(0.8)

            arrow3 = MathTex(r"\Downarrow", font_size=28).next_to(open_txt, DOWN, buff=0.2)
            final = MathTex(finals[i], font_size=36, color=colors[i]).next_to(arrow3, DOWN, buff=0.2)
            self.play(Write(arrow3), Write(final))
            self.wait(1.2)

            self.play(FadeOut(cap), FadeOut(cond), FadeOut(sign), FadeOut(sign_txt),
                      FadeOut(arrow2), FadeOut(open_txt), FadeOut(arrow3), FadeOut(final))

        cap_assemble = caption("מאחדים את שלושת התוצאות לפונקציה מקוטעת אחת")
        self.play(Write(cap_assemble))

        brace_lines = VGroup(
            MathTex(r"-2x+2 & x<-1", font_size=32, color="#00FFB3"),
            MathTex(r"4 & -1\le x<3", font_size=32, color="#00BFFF"),
            MathTex(r"2x-2 & x\ge 3", font_size=32, color="#FFB300"),
        ).arrange(DOWN, buff=0.35, aligned_edge=LEFT)
        brace = Brace(brace_lines, LEFT)
        piecewise = VGroup(brace, brace_lines).move_to(ORIGIN + UP * 0.3)
        f_label = MathTex(r"f(x)=", font_size=36).next_to(brace, LEFT)

        self.play(Write(f_label), GrowFromCenter(brace), Write(brace_lines))
        self.wait(2)

        self.play(FadeOut(f_label), FadeOut(piecewise), FadeOut(cap_assemble))

        cap_graph = caption("וזה הגרף שמתקבל - כל קטע בצבע של התחום שלו")
        self.play(Write(cap_graph))

        axes = Axes(
            x_range=[-6, 8, 1], y_range=[-1, 12, 2],
            x_length=10, y_length=5,
            axis_config={"include_tip": True, "font_size": 22},
        ).shift(UP * 0.3)
        self.play(Create(axes))

        seg1 = axes.plot(lambda x: -2 * x + 2, x_range=[-6, -1], color="#00FFB3", stroke_width=6)
        seg2 = axes.plot(lambda x: 4, x_range=[-1, 3], color="#00BFFF", stroke_width=6)
        seg3 = axes.plot(lambda x: 2 * x - 2, x_range=[3, 8], color="#FFB300", stroke_width=6)
        self.play(Create(seg1), Create(seg2), Create(seg3), run_time=1.5)

        dot1 = Dot(axes.c2p(-1, 4), color=YELLOW, radius=0.08)
        dot2 = Dot(axes.c2p(3, 4), color=YELLOW, radius=0.08)
        self.play(FadeIn(dot1), FadeIn(dot2))
        self.wait(2.5)
