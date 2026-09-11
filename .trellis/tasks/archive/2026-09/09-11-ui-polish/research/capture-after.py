"""Capture after-polish QA preview screenshots for 09-11-ui-polish."""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:1421"
OUT_DIR = sys.argv[1] if len(sys.argv) > 1 else "after"
OUT = f"/Users/zhoujiaangyao/zhoujiangyao/AI/desktop-ai-pet/.trellis/tasks/09-11-ui-polish/research/shots/{OUT_DIR}"


def main() -> None:
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})

        page.goto(f"{BASE}/qa/chat-preview.html")
        page.wait_for_timeout(1200)
        page.screenshot(path=f"{OUT}/a01-panel-compact-attached.png")

        page.goto(f"{BASE}/qa/chat-preview.html?mode=expanded")
        page.wait_for_timeout(1200)
        page.screenshot(path=f"{OUT}/a02-panel-expanded-empty.png")

        page.click('button[aria-label="查看待办列表"]')
        page.wait_for_timeout(1200)
        page.screenshot(path=f"{OUT}/a03-panel-todos-error.png")

        page.click('button[aria-label="返回聊天"]')
        page.wait_for_timeout(600)
        page.click('button[aria-label="配置助手服务"]')
        page.wait_for_timeout(800)
        page.screenshot(path=f"{OUT}/a04-panel-settings.png")

        # Diagnosis fixture: messages + reminder card + tool result.
        page.goto(f"{BASE}/qa/diagnosis-preview.html")
        page.wait_for_timeout(1500)
        page.screenshot(path=f"{OUT}/a09-panel-expanded-messages.png")

        # Frame previews: shell intactness after CSS changes.
        page.goto(f"{BASE}/qa/frame-preview.html")
        page.wait_for_timeout(1000)
        page.select_option("select >> nth=1", "attached")
        page.wait_for_timeout(800)
        page.screenshot(path=f"{OUT}/a07-frame-attached-compact.png")

        page.goto(f"{BASE}/qa/frame-preview.html?mode=expanded")
        page.wait_for_timeout(800)
        page.select_option("select >> nth=1", "attached")
        page.wait_for_timeout(800)
        page.screenshot(path=f"{OUT}/a08-frame-attached-expanded.png")

        browser.close()


if __name__ == "__main__":
    main()
