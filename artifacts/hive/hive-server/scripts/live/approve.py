"""
Best-effort automation of the PayPal SANDBOX approval page for scripts/wasplab-live.ts.
PayPal changes its pages often, so these selectors may need updating. Use LIVE_APPROVER=manual if this fails.

Usage: SANDBOX_BUYER_EMAIL=... SANDBOX_BUYER_PASSWORD=... python3 scripts/live/approve.py <approve-url>
Requires: pip install playwright && playwright install chromium
"""
import os, sys, re
from playwright.sync_api import sync_playwright

url = sys.argv[1]
email, password = os.environ.get('SANDBOX_BUYER_EMAIL'), os.environ.get('SANDBOX_BUYER_PASSWORD')
if not email or not password:
    sys.exit('Set SANDBOX_BUYER_EMAIL and SANDBOX_BUYER_PASSWORD (a sandbox personal account).')
if 'sandbox' not in url:
    sys.exit('Refusing to run: this is not a sandbox URL.')

BUTTONS = re.compile(r'(complete purchase|pay now|continue|agree and continue|save and continue)', re.I)

with sync_playwright() as p:
    b = p.chromium.launch(headless=os.environ.get('LIVE_HEADLESS', 'true') != 'false')
    pg = b.new_page()
    try:
        pg.goto(url, wait_until='domcontentloaded')
        pg.wait_for_selector('#email', timeout=20000)
        pg.fill('#email', email)
        if pg.locator('#btnNext').count():
            pg.click('#btnNext')
        pg.wait_for_selector('#password', timeout=20000)
        pg.fill('#password', password)
        pg.click('#btnLogin')
        for _ in range(6):
            pg.wait_for_timeout(2500)
            if 'sandbox' not in pg.url or '/checkoutnow' not in pg.url and 'paypal.com' not in pg.url:
                break  # redirected back to the merchant
            btn = pg.get_by_role('button', name=BUTTONS)
            if btn.count():
                btn.first.click()
        print('approval flow finished at', pg.url[:80])
    except Exception as e:
        pg.screenshot(path='/tmp/hive-approve-fail.png')
        print('approval failed:', str(e)[:300], '(screenshot: /tmp/hive-approve-fail.png)')
        sys.exit(1)
    finally:
        b.close()
