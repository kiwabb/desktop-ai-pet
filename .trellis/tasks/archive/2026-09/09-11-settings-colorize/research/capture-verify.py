"""Capture settings-page shots + programmatic computed-style assertions.

Task 09-11-settings-colorize: the settings surface must speak the DESIGN.md
token language (capsule inputs, warm-white tiles, primary-gradient save).
We cannot view images, so every visual requirement is asserted on computed
styles; screenshots are stored for the main session's human review.
"""
import json
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:1421"
OUT = "/Users/zhoujiaangyao/zhoujiangyao/AI/desktop-ai-pet/.trellis/tasks/09-11-settings-colorize/research/shots"

failures: list[str] = []


def check(name: str, actual, expected) -> None:
    ok = actual == expected
    if not ok:
        failures.append(f"{name}: expected {expected!r}, got {actual!r}")
    print(f"{'PASS' if ok else 'FAIL'} {name}: {actual!r}")


def main() -> None:
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})

        page.goto(f"{BASE}/qa/chat-preview.html")
        page.wait_for_timeout(1200)
        page.click('button[aria-label="配置助手服务"]')
        page.wait_for_timeout(800)
        page.screenshot(path=f"{OUT}/s01-settings-server.png")

        # --- capsule input language -------------------------------------
        styles = page.evaluate(
            """() => {
              const input = document.querySelector('.assistant-settings input')
              const cs = getComputedStyle(input)
              const label = getComputedStyle(document.querySelector('.assistant-settings label'))
              const h2 = getComputedStyle(document.querySelector('.assistant-settings h2'))
              const save = document.querySelector('.assistant-settings-save')
              const saveCs = getComputedStyle(save)
              const card = getComputedStyle(document.querySelector('.assistant-settings-card'))
              return {
                inputRadius: cs.borderRadius,
                inputBorder: cs.borderColor,
                inputBg: cs.backgroundColor,
                inputFontSize: cs.fontSize,
                labelWeight: label.fontWeight,
                h2Weight: h2.fontWeight,
                h2Size: h2.fontSize,
                saveBg: saveCs.backgroundImage,
                saveWeight: getComputedStyle(save.querySelector('strong')).fontWeight,
                cardShadow: card.boxShadow,
              }
            }"""
        )
        print(json.dumps(styles, ensure_ascii=False, indent=1))
        check("input is a capsule (999px)", styles["inputRadius"], "999px")
        check("input font on type ramp", styles["inputFontSize"], "14px")
        check("input surface #fffdf9", styles["inputBg"], "rgb(255, 253, 249)")
        check("label weight on ladder", styles["labelWeight"], "600")
        check("h2 weight on ladder", styles["h2Weight"], "700")
        if styles["h2Size"] not in ("11px", "12px", "13px", "14px", "16px", "21px"):
            failures.append(f"h2 size off type ramp: {styles['h2Size']}")
        else:
            print(f"PASS h2 size on type ramp: {styles['h2Size']!r}")
        check("save strong weight", styles["saveWeight"], "700")
        if "#7f4423" in styles["saveBg"] or "rgb(189, 113, 69)" not in styles["saveBg"]:
            failures.append(f"save button not primary gradient: {styles['saveBg']}")

        # focus ring
        page.focus(".assistant-settings input")
        page.wait_for_timeout(300)
        focus = page.evaluate(
            """() => {
              const cs = getComputedStyle(document.querySelector('.assistant-settings input'))
              return { border: cs.borderColor, ring: cs.boxShadow }
            }"""
        )
        print(focus)
        check("focus border is --input-focus", focus["border"], "rgba(165, 106, 72, 0.65)")
        if "rgba(165, 106, 72, 0.1)" not in focus["ring"]:
            failures.append(f"focus ring missing: {focus['ring']}")
        page.screenshot(path=f"{OUT}/s02-settings-input-focus.png")

        # local mode (second inputs branch)
        page.click('.assistant-settings-mode button >> text=单机')
        page.wait_for_timeout(500)
        page.screenshot(path=f"{OUT}/s03-settings-local.png")

        # error state: submit with invalid url? fixture intercepts submit; use
        # the diagnosis fixture instead for a full expanded view.
        page.goto(f"{BASE}/qa/diagnosis-preview.html")
        page.wait_for_timeout(1500)
        page.screenshot(path=f"{OUT}/s04-diagnosis-expanded.png")

        browser.close()

    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(" -", f)
        sys.exit(1)
    print("\nAll computed-style assertions passed.")


if __name__ == "__main__":
    main()
