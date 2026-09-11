"""Programmatic verification of the 09-11 polish: computed styles + copy."""
import colorsys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:1421"


def lum(rgb):
    r, g, b = [c / 255 for c in rgb]
    def f(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = f(r), f(g), f(b)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def parse_rgba(value):
    parts = value.replace("rgba(", "").replace("rgb(", "").rstrip(")").split(",")
    return tuple(float(p) for p in parts[:3])


def contrast(fg, bg):
    l1, l2 = lum(fg), lum(bg)
    if l1 < l2:
        l1, l2 = l2, l1
    return (l1 + 0.05) / (l2 + 0.05)


def effective_bg(page, el):
    """Walk ancestors for the first opaque-ish background color."""
    return page.evaluate("""(el) => {
      let node = el;
      while (node) {
        const c = getComputedStyle(node).backgroundColor;
        const m = c.match(/rgba?\\(([^)]+)\\)/);
        if (m) {
          const parts = m[1].split(',').map(Number);
          if (parts.length < 4 || parts[3] > 0.9) return c;
        }
        node = node.parentElement;
      }
      return 'rgb(255, 255, 255)';
    }""", el)


def main() -> None:
    failures = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})

        def check(name, ok, detail):
            print(("PASS" if ok else "FAIL"), name, "-", detail)
            if not ok:
                failures.append(name)

        # --- Expanded empty state ---
        page.goto(f"{BASE}/qa/chat-preview.html?mode=expanded")
        page.wait_for_timeout(1200)
        cat = page.query_selector(".empty-cat")
        check("empty-state cat present", cat is not None, "img.empty-cat in DOM")
        if cat:
            box = cat.bounding_box()
            check("empty-cat size 72px (smaller than the 232px pet)", box and 68 <= box["width"] <= 76, f"{box and box['width']}px")
        p = page.query_selector(".empty-state p")
        fg = parse_rgba(p.evaluate("el => getComputedStyle(el).color"))
        bg = parse_rgba(effective_bg(page, p))
        ratio = contrast(fg, bg)
        check("empty-state p contrast >= 4.5", ratio >= 4.5, f"{ratio:.2f}:1 ({p.evaluate('el=>getComputedStyle(el).color')} on {bg})")
        check("no eyebrow", page.query_selector(".empty-eyebrow") is None, "eyebrow removed")
        h2w = page.query_selector(".empty-state h2").evaluate("el => getComputedStyle(el).fontWeight")
        check("empty h2 weight 700", h2w == "700", h2w)

        # --- Todos error state: friendly copy ---
        page.click('button[aria-label="查看待办列表"]')
        page.wait_for_timeout(1200)
        notice = page.query_selector(".todo-list-notice.is-error p")
        text = notice.inner_text() if notice else ""
        check("todo error friendly", "待办读取失败" in text and "invoke" not in text and "undefined" not in text, text)

        # --- Compact attached: icon buttons framed, pin badge small ---
        page.goto(f"{BASE}/qa/chat-preview.html")
        page.wait_for_timeout(1200)
        btn = page.query_selector(".chat-panel .header-actions .icon-button")
        style = btn.evaluate("""el => { const s = getComputedStyle(el); return { w: s.width, b: s.borderTopWidth, bc: s.borderTopColor, r: s.borderTopLeftRadius, bg: s.backgroundImage || s.backgroundColor } }""")
        check("compact icon button framed", style["b"] == "1px" and style["bg"] not in ("none", "rgba(0, 0, 0, 0)", "transparent"), str(style))
        pin = page.query_selector(".pin-indicator")
        pbox = pin.bounding_box()
        check("pin badge small", pbox and pbox["width"] <= 27, f"{pbox and pbox['width']}px")
        # placeholder contrast (compact legacy path uses var(--muted-soft))
        ta = page.query_selector(".composer textarea")
        ph = ta.evaluate("el => getComputedStyle(el, '::placeholder').color")
        tbg = parse_rgba(ta.evaluate("el => getComputedStyle(el).backgroundColor") or "rgb(255,255,255)")
        if "0, 0, 0, 0" in ta.evaluate("el => getComputedStyle(el).backgroundColor"):
            tbg = parse_rgba(effective_bg(page, ta))
        ratio = contrast(parse_rgba(ph), tbg)
        check("placeholder contrast >= 4.5", ratio >= 4.5, f"{ratio:.2f}:1 ({ph})")

        # --- Diagnosis fixture: messages, reminder time, tool result, blockquote ---
        page.goto(f"{BASE}/qa/diagnosis-preview.html")
        page.wait_for_timeout(1500)
        rtime = page.query_selector(".todo-reminder-card time")
        rtext = rtime.inner_text() if rtime else ""
        check("reminder time no GMT", "GMT" not in rtext, rtext)
        bub = page.query_selector(".chat-panel.is-attached.is-expanded .message:not(.message-user) .message-bubble")
        bs = bub.evaluate("""el => { const s = getComputedStyle(el); return { b: s.borderTopColor, sh: s.boxShadow, bg: s.backgroundImage } }""")
        check("expanded bubble bright surface + visible border", "0, 0, 0, 0" not in bs["b"] and "255, 255, 255" in bs["bg"], str(bs))
        tool_bar = page.query_selector(".agent-tool-result strong")
        ttext = tool_bar.inner_text() if tool_bar else ""
        check("tool result user language", ttext == "待办列表 · 已完成", ttext)
        # Reminder strip is a visibly deeper warm band than the bubble surface.
        strip = page.query_selector(".todo-reminders")
        strip_bg = strip.evaluate("el => getComputedStyle(el).backgroundImage")
        check("reminder strip deeper warm band", "247, 233, 210" in strip_bg, strip_bg)
        sub = page.query_selector(".chat-panel .assistant-identity p")
        if sub:
            sfg = parse_rgba(sub.evaluate("el => getComputedStyle(el).color"))
            sbg = parse_rgba(effective_bg(page, sub))
            ratio = contrast(sfg, sbg)
            check("subtitle contrast >= 4.5", ratio >= 4.5, f"{ratio:.2f}:1")
        hdr_btn = page.query_selector(".chat-panel.is-expanded .header-actions .icon-button")
        hs = hdr_btn.evaluate("el => { const s = getComputedStyle(el); return { w: s.width, b: s.borderTopWidth } }")
        check("expanded icon button 44px framed", hs["w"] == "44px" and hs["b"] == "1px", str(hs))

        browser.close()

    print("\n%d failure(s)" % len(failures))
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
