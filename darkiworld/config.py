"""
Configuration module for Darkiworld Scraper
Centralizes all environment variables, constants, and logging setup.

NOTE: This config now reads from the main .env file at the project root.
The local darkiworld/.env is no longer used.
"""

import os
import logging
from dotenv import load_dotenv

# Load environment variables from parent .env file
# Look for .env in parent directory (project root)
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dotenv_path = os.path.join(parent_dir, '.env')
load_dotenv(dotenv_path)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Darkiworld URL
DARKIWORLD_URL = os.getenv('DARKIWORLD_URL', 'https://darkiworld15.com/')

# Allowed hosters for filtering releases
ALLOWED_HOSTER = os.getenv('DARKIWORLD_ALLOWED_HOSTER', '').split(',')
ALLOWED_HOSTER = [h.strip().lower() for h in ALLOWED_HOSTER if h.strip()]

# Essential cookies for authentication
ESSENTIAL_COOKIES = {
    'remember_web_3dc7a913ef5fd4b890ecabe3487085573e16cf82': os.getenv('DARKIWORLD_REMEMBER_TOKEN', ''),
    'darkiworld_session': os.getenv('DARKIWORLD_SESSION', ''),
    'XSRF-TOKEN': os.getenv('DARKIWORLD_XSRF_TOKEN', ''),
    'connected': os.getenv('DARKIWORLD_CONNECTED', '1'),
    'SERVERID': os.getenv('DARKIWORLD_SERVERID', 'S1'),
}

# AllDebrid API configuration
ALLDEBRID_API_KEY = os.getenv('DARKIWORLD_ALLDEBRID_KEY', '')
ALLDEBRID_API_URL = 'https://api.alldebrid.com/v4/link/unlock'

# Server configuration
PORT = int(os.getenv('DARKIWORLD_PORT', 5002))
DEBUG = os.getenv('DARKIWORLD_DEBUG', 'false').lower() == 'true'
