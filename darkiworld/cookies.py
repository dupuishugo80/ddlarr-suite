"""
Cookie management module for Darkiworld Scraper
Handles authentication cookies via CDP (Chrome DevTools Protocol).
"""

import logging
from urllib.parse import urlparse
from config import ESSENTIAL_COOKIES

logger = logging.getLogger(__name__)


def set_cookies(driver, url: str) -> int:
    """Set cookies using CDP (Chrome DevTools Protocol) for httpOnly support
    
    Args:
        driver: Selenium Chrome driver
        url: Target URL for cookies
        
    Returns:
        Number of cookies successfully set
    """
    parsed = urlparse(url)
    domain = parsed.netloc.replace('www.', '')

    cookies_set = 0
    cookies_skipped = []

    for name, value in ESSENTIAL_COOKIES.items():
        if not value:
            cookies_skipped.append(name)
            logger.warning(f"⚠️ Cookie '{name}' is EMPTY - skipping (check your .env file)")
            continue

        try:
            # Use CDP to set cookies (supports httpOnly cookies)
            cookie_dict = {
                'name': name,
                'value': value,
                'domain': f'.{domain}',
                'path': '/',
                'secure': True,
                'httpOnly': True,  # Now we can set httpOnly cookies!
                'sameSite': 'Lax'
            }

            driver.execute_cdp_cmd('Network.setCookie', cookie_dict)
            cookies_set += 1
            logger.info(f"✓ Set cookie via CDP: {name} (httpOnly: True)")
        except Exception as e:
            logger.warning(f"❌ Failed to set cookie {name}: {e}")

            # Fallback to regular Selenium method (for non-httpOnly cookies)
            try:
                cookie_dict_fallback = {
                    'name': name,
                    'value': value,
                    'domain': f'.{domain}',
                    'path': '/',
                    'secure': True,
                    'sameSite': 'Lax'
                }
                driver.add_cookie(cookie_dict_fallback)
                cookies_set += 1
                logger.info(f"✓ Set cookie via Selenium (fallback): {name}")
            except Exception as e2:
                logger.error(f"❌ Failed to set cookie {name} (both methods): {e2}")

    if cookies_set > 0:
        logger.info(f"✓ Successfully set {cookies_set}/{len(ESSENTIAL_COOKIES)} cookies")
    else:
        logger.error("❌ NO cookies were set!")

    if cookies_skipped:
        logger.error(f"❌ MISSING cookies (empty in .env): {', '.join(cookies_skipped)}")
        logger.error("⚠️ Authentication will likely FAIL without these cookies!")

    return cookies_set
