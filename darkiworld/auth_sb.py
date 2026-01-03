"""
Authentication module using SeleniumBase for Darkiworld Scraper
Handles automatic login with Cloudflare Turnstile support
"""

import os
import json
import time
import logging

logger = logging.getLogger(__name__)

COOKIES_FILE = os.path.join(os.path.dirname(__file__), 'cookies.json')


def save_cookies(sb, filepath: str = COOKIES_FILE) -> None:
    """Save essential cookies from SeleniumBase driver to JSON file

    Essential cookies:
    - SERVERID
    - connected
    - XSRF-TOKEN
    - darkiworld_session
    - remember_web_* (any cookie starting with remember_web_)
    """
    try:
        all_cookies = sb.driver.get_cookies()

        # Filter only essential cookies
        essential_cookies = []
        essential_names = {'SERVERID', 'connected', 'XSRF-TOKEN', 'darkiworld_session'}

        for cookie in all_cookies:
            cookie_name = cookie['name']
            # Keep if in essential list OR starts with remember_web_
            if cookie_name in essential_names or cookie_name.startswith('remember_web_'):
                essential_cookies.append(cookie)
                logger.debug(f"Keeping cookie: {cookie_name}")

        with open(filepath, 'w') as f:
            json.dump(essential_cookies, f, indent=2)
        logger.info(f"✓ Saved {len(essential_cookies)} essential cookies to {filepath}")

        # Log which cookies were saved
        saved_names = [c['name'] for c in essential_cookies]
        logger.debug(f"Saved cookies: {', '.join(saved_names)}")

    except Exception as e:
        logger.error(f"Failed to save cookies: {e}")


def load_cookies(sb, url: str, filepath: str = COOKIES_FILE) -> bool:
    """Load cookies from JSON file into SeleniumBase driver"""
    if not os.path.exists(filepath):
        logger.info("No saved cookies file found")
        return False

    try:
        with open(filepath, 'r') as f:
            cookies = json.load(f)

        if not cookies:
            logger.warning("Cookies file is empty")
            return False

        # Navigate to the domain first
        sb.open(url)

        loaded_count = 0
        for cookie in cookies:
            try:
                sb.driver.add_cookie(cookie)
                loaded_count += 1
            except Exception as e:
                logger.debug(f"Could not set cookie {cookie.get('name')}: {e}")

        logger.info(f"✓ Loaded {loaded_count}/{len(cookies)} cookies from file")
        return loaded_count > 0

    except Exception as e:
        logger.error(f"Failed to load cookies: {e}")
        return False


def is_authenticated(sb) -> bool:
    """Check if user is authenticated by looking for 'Connexion' text"""
    try:
        body_text = sb.get_text("body").lower()
        has_login_button = 'connexion' in body_text

        if has_login_button:
            logger.info("❌ Not authenticated - 'Connexion' button found")
            return False
        else:
            logger.info("✓ Authenticated - no 'Connexion' button found")
            return True

    except Exception as e:
        logger.error(f"Error checking authentication status: {e}")
        return False


def login(sb, url: str, email: str, password: str) -> bool:
    """Perform login on Darkiworld using SeleniumBase"""
    try:
        login_url = f"{url}login" if not url.endswith('/') else f"{url}login"
        logger.info(f"Navigating to login page: {login_url}")

        # Use uc_open_with_reconnect for better Cloudflare handling
        sb.uc_open_with_reconnect(login_url, 2)
        logger.info("✓ Page loaded with UC reconnect")

        # Wait for email field
        logger.info("Waiting for login form...")
        sb.wait_for_element("input[name='email']", timeout=15)
        logger.info("✓ Login form visible")

        # Fill email
        logger.info("Filling email field...")
        sb.type("input[name='email']", email)
        logger.info("✓ Email filled")

        # Fill password
        logger.info("Filling password field...")
        sb.type("input[name='password']", password)
        logger.info("✓ Password filled")

        # Check remember me checkbox
        logger.info("Checking 'remember me' checkbox...")
        try:
            checkbox = sb.find_element("input[name='remember']")
            is_checked = checkbox.get_attribute('aria-checked') == 'true'

            if not is_checked:
                sb.click("input[name='remember']")
                logger.info("✓ 'Remember me' checked")
            else:
                logger.info("✓ 'Remember me' already checked")
        except Exception as e:
            logger.warning(f"Could not check 'remember me': {e}")

        # Wait for Cloudflare Turnstile to validate
        logger.info("Waiting for Cloudflare Turnstile validation...")
        logger.info("(Waiting 5 seconds for Turnstile to auto-validate or manual click)")

        # Simple wait - let Turnstile validate automatically or user can click manually
        time.sleep(5)

        logger.info("✓ Proceeding with form submission...")

        # Submit the form
        logger.info("Submitting login form...")
        sb.click("button[type='submit']")
        logger.info("✓ Login form submitted")

        # Wait for navigation
        logger.info("Waiting for login to complete...")
        time.sleep(2)

        # Check if login was successful
        if is_authenticated(sb):
            logger.info("✅ Login successful!")
            save_cookies(sb)
            return True
        else:
            logger.error("❌ Login failed - still seeing 'Connexion' button")
            return False

    except Exception as e:
        logger.error(f"Error during login: {e}", exc_info=True)
        return False


def ensure_authenticated(sb, url: str, email: str, password: str) -> bool:
    """Ensure user is authenticated, login if necessary"""
    logger.info("Ensuring authentication...")

    # Try to load saved cookies first
    cookies_loaded = load_cookies(sb, url)

    if cookies_loaded:
        # Reload page with cookies
        sb.open(url)
        time.sleep(1)

        # Check if cookies are still valid
        if is_authenticated(sb):
            logger.info("✅ Already authenticated with saved cookies")
            return True
        else:
            logger.info("⚠️ Saved cookies are expired/invalid, need to login")
    else:
        logger.info("No saved cookies, need to login")

    # Need to login
    if not email or not password:
        logger.error("❌ Email and password are required for login")
        return False

    logger.info("Attempting to login...")
    success = login(sb, url, email, password)

    if success:
        logger.info("✅ Authentication successful")
    else:
        logger.error("❌ Authentication failed")

    return success
