"""Capture QA preview screenshots for the 09-11 UI polish diagnosis."""
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:1421"
OUT = "/Users/zhoujiaangyao/zhoujiangyao/AI/desktop-ai-pet/.trellis/tasks/09-11-ui-polish/research/shots"


def main() -> None:
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})

        # 1. Compact attached bubble next to the pet (default view).
        page.goto(f"{BASE}/qa/chat-preview.html")
        page.wait_for_timeout(1200)
        page.screenshot(path=f"{OUT}/01-panel-compact-attached.png")

        # 2. Expanded panel, empty / unconfigured state.
        page.goto(f"{BASE}/qa/chat-preview.html?mode=expanded")
        page.wait_for_timeout(1200)
        page.screenshot(path=f"{OUT}/02-panel-expanded-empty.png")

        # 3. Expanded panel -> todo list view (backend absent: error state).
        page.click('button[aria-label="查看待办列表"]')
        page.wait_for_timeout(1200)
        page.screenshot(path=f"{OUT}/03-panel-todos-error.png")

        # 4. Back to chat, then settings view.
        page.click('button[aria-label="返回聊天"]')
        page.wait_for_timeout(600)
        page.click('button[aria-label="配置助手服务"]')
        page.wait_for_timeout(800)
        page.screenshot(path=f"{OUT}/04-panel-settings.png")

        # 5. Standalone frame, compact + expanded.
        page.goto(f"{BASE}/qa/frame-preview.html")
        page.wait_for_timeout(1000)
        page.screenshot(path=f"{OUT}/05-frame-standalone-compact.png")

        page.goto(f"{BASE}/qa/frame-preview.html?mode=expanded")
        page.wait_for_timeout(1000)
        page.screenshot(path=f"{OUT}/06-frame-standalone-expanded.png")

        # 6. Attached frame (integrated shell) compact + expanded.
        page.goto(f"{BASE}/qa/frame-preview.html")
        page.wait_for_timeout(800)
        page.select_option("select >> nth=1", "attached")  # 外观 select
        page.wait_for_timeout(800)
        page.screenshot(path=f"{OUT}/07-frame-attached-compact.png")

        page.goto(f"{BASE}/qa/frame-preview.html?mode=expanded")
        page.wait_for_timeout(800)
        page.select_option("select >> nth=1", "attached")
        page.wait_for_timeout(800)
        page.screenshot(path=f"{OUT}/08-frame-attached-expanded.png")

        browser.close()


if __name__ == "__main__":
    main()
