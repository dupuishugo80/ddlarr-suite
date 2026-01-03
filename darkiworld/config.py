"""
Configuration module for Darkiworld Scraper
Centralizes all environment variables, constants, and logging setup.

For development: uses local darkiworld/.env
For Docker: uses parent .env file
"""

import os
import logging
from dotenv import load_dotenv

# Try to load local .env first (for development)
local_env = os.path.join(os.path.dirname(__file__), '.env')
if os.path.exists(local_env):
    load_dotenv(local_env)
    logger = logging.getLogger(__name__)
    logger.info(f"Loaded environment from local .env: {local_env}")
else:
    # Fallback to parent .env (for Docker)
    parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dotenv_path = os.path.join(parent_dir, '.env')
    load_dotenv(dotenv_path)
    logger = logging.getLogger(__name__)
    logger.info(f"Loaded environment from parent .env: {dotenv_path}")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Darkiworld URL
DARKIWORLD_URL = os.getenv('DARKIWORLD_URL', 'https://darkiworld15.com/')

# Authentication credentials
DARKIWORLD_EMAIL = os.getenv('DARKIWORLD_EMAIL', '')
DARKIWORLD_PASSWORD = os.getenv('DARKIWORLD_PASSWORD', '')

# Allowed hosters for filtering releases
ALLOWED_HOSTER = os.getenv('DARKIWORLD_ALLOWED_HOSTER', '').split(',')
ALLOWED_HOSTER = [h.strip().lower() for h in ALLOWED_HOSTER if h.strip()]

# AllDebrid API configuration
ALLDEBRID_API_KEY = os.getenv('DARKIWORLD_ALLDEBRID_KEY', '')
ALLDEBRID_API_URL = 'https://api.alldebrid.com/v4/link/unlock'

# Server configuration
PORT = int(os.getenv('DARKIWORLD_PORT', 5002))
DEBUG = os.getenv('DARKIWORLD_DEBUG', 'false').lower() == 'true'
