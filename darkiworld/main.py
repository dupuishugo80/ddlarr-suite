"""
Darkiworld Scraper - Main Entry Point

A Flask-based scraper for Darkiworld with Cloudflare bypass,
authentication via cookies, and AllDebrid integration.
"""

import logging
from flask import Flask
from config import DARKIWORLD_URL, ESSENTIAL_COOKIES, ALLOWED_HOSTER, PORT, DEBUG
from driver import close_driver
from routes import api

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create Flask app
app = Flask(__name__)

# Register API routes
app.register_blueprint(api)


if __name__ == '__main__':
    logger.info(f"Starting Darkiworld Scraper on port {PORT}")
    logger.info(f"Target URL: {DARKIWORLD_URL}")
    logger.info(f"Cookies configured: {len([v for v in ESSENTIAL_COOKIES.values() if v])} essential cookies")
    logger.info(f"Allowed hosters: {ALLOWED_HOSTER if ALLOWED_HOSTER else 'ALL (no filter)'}")

    try:
        app.run(host='0.0.0.0', port=PORT, debug=DEBUG)
    finally:
        # Cleanup driver on exit
        close_driver()
