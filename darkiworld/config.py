"""
Configuration module for Darkiworld Scraper
Centralizes all environment variables, constants, and logging setup.

For development: uses local darkiworld/.env
For Docker: uses parent .env file
"""

import os
import json
import logging
import requests
import time
from typing import Optional
from dotenv import load_dotenv

# Try to load local .env first (for development)
local_env = os.path.join(os.path.dirname(__file__), '.env')
if os.path.exists(local_env):
    load_dotenv(local_env)
else:
    # Fallback to parent .env (for Docker)
    parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dotenv_path = os.path.join(parent_dir, '.env')
    load_dotenv(dotenv_path)

# Load DEBUG mode first (needed for logging configuration)
DEBUG = os.getenv('DEBUG', 'false').lower() == 'true'

# Configure logging based on DEBUG mode
logging.basicConfig(
    level=logging.DEBUG if DEBUG else logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def get_url_after_redirect(url: str, timeout: int = 5) -> Optional[str]:
    """
    Get final URL after following HTTP redirects.
    Similar to indexer's getUrlAfterRedirect() in TypeScript.

    Args:
        url: Initial URL to follow
        timeout: Request timeout in seconds

    Returns:
        Final URL after redirects, or None if error
    """
    try:
        response = requests.get(
            url,
            timeout=timeout,
            allow_redirects=True,  # Follow redirects (default)
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            }
        )
        # response.url contains the final URL after all redirects
        return response.url
    except Exception as e:
        logger.error(f"Error getting URL after redirect for {url}: {e}")
        return None


# URL resolution caches with TTL (refreshed every hour like indexer)
# Two separate URLs: login/base (hydracker.com) and scrape/search (dd.hydracker.com)
CACHE_TTL = 60 * 60  # 1 hour in seconds
LOGIN_URL_START = 'https://hydracker.com/'
SCRAPE_URL_START = 'https://dd.hydracker.com/'

_url_cache: dict = {}  # starting_url -> (resolved_url, timestamp)


def _resolve_url(starting_url: str, env_var: Optional[str], label: str) -> str:
    """
    Resolve URL with lazy resolution and TTL caching.

    Priority:
    1. Env var (if set and not empty)
    2. Cached resolved URL (if not expired)
    3. Resolve via redirect from starting_url
    4. Fallback to starting_url
    """
    if env_var:
        env_url = os.getenv(env_var, '').strip()
        if env_url:
            logger.debug(f"Using {label} from environment: {env_url}")
            return env_url

    cached = _url_cache.get(starting_url)
    if cached:
        cached_url, cached_at = cached
        age = time.time() - cached_at
        if age < CACHE_TTL:
            logger.debug(f"Using cached {label} (age: {int(age)}s): {cached_url}")
            return cached_url
        else:
            logger.info(f"{label} cache expired (age: {int(age)}s), re-resolving...")

    logger.info(f"Resolving {label} via redirect from {starting_url}...")
    resolved = get_url_after_redirect(starting_url)

    if resolved:
        _url_cache[starting_url] = (resolved, time.time())
        logger.info(f"✓ {label} resolved and cached: {resolved}")
        return resolved

    logger.warning(f"Could not resolve {label}, using default: {starting_url}")
    _url_cache[starting_url] = (starting_url, time.time())
    return starting_url


def get_darkiworld_url() -> str:
    """Login/base URL (hydracker.com) — used for authentication flow."""
    return _resolve_url(LOGIN_URL_START, 'DARKIWORLD_URL', 'Darkiworld login URL')


def get_darkiworld_scrape_url() -> str:
    """Scrape/search URL (dd.hydracker.com) — used for search API calls."""
    return _resolve_url(SCRAPE_URL_START, 'DARKIWORLD_SCRAPE_URL', 'Darkiworld scrape URL')


# Static config from env (no lazy loading for these)
DARKIWORLD_URL = get_darkiworld_url()
DARKIWORLD_SCRAPE_URL = get_darkiworld_scrape_url()

# AllDebrid API configuration
ALLDEBRID_API_KEY = os.getenv('DARKIWORLD_ALLDEBRID_KEY', '')
ALLDEBRID_API_URL = 'https://api.alldebrid.com/v4/link/unlock'

# Server configuration
PORT = int(os.getenv('DARKIWORLD_PORT', 5002))

# Persistent config file path (saved to /app/config/ which should be a Docker volume)
CONFIG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config')
CONFIG_FILE = os.path.join(CONFIG_DIR, 'credentials.json')


def _load_config_from_disk() -> dict:
    """Load saved credentials from disk, returns defaults if file doesn't exist."""
    defaults = {
        'enabled': False,
        'email': '',
        'password': '',
        'authenticated': False,
    }
    try:
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, 'r') as f:
                saved = json.load(f)
            # Merge saved values into defaults (in case new keys are added later)
            defaults.update(saved)
            # Always reset authenticated on startup - session cookies are not persisted
            defaults['authenticated'] = False
            logger.info(f"Loaded credentials from {CONFIG_FILE} (email: {defaults['email'] or 'not set'})")
    except Exception as e:
        logger.warning(f"Failed to load config from {CONFIG_FILE}: {e}")
    return defaults


def _save_config_to_disk() -> None:
    """Save current credentials to disk for persistence across restarts."""
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        data = {
            'enabled': runtime_config['enabled'],
            'email': runtime_config['email'],
            'password': runtime_config['password'],
        }
        with open(CONFIG_FILE, 'w') as f:
            json.dump(data, f, indent=2)
        logger.info(f"Saved credentials to {CONFIG_FILE}")
    except Exception as e:
        logger.warning(f"Failed to save config to {CONFIG_FILE}: {e}")


# Runtime configuration (can be updated via API)
# This allows dynamic configuration from the indexer UI
# Darkiworld is disabled by default - must pass login test to enable
# Credentials are configured via the web UI, not environment variables
# On startup, credentials are loaded from disk if previously saved
runtime_config = _load_config_from_disk()


def update_runtime_config(new_config: dict) -> dict:
    """
    Update runtime configuration with new values.
    Only updates provided keys, preserves others.
    
    Args:
        new_config: Dict with keys to update (enabled, email, password)
        
    Returns:
        Current config (without password)
    """
    global runtime_config
    
    if 'enabled' in new_config:
        runtime_config['enabled'] = bool(new_config['enabled'])
        logger.info(f"Runtime config: enabled = {runtime_config['enabled']}")
        
    if 'email' in new_config:
        runtime_config['email'] = new_config['email']
        logger.info(f"Runtime config: email updated")
        
    if 'password' in new_config and new_config['password']:
        runtime_config['password'] = new_config['password']
        runtime_config['authenticated'] = False  # Need to re-login with new password
        logger.info("Runtime config: password updated, will re-authenticate")

    _save_config_to_disk()

    return get_runtime_config()


def get_runtime_config(include_sensitive: bool = False) -> dict:
    """
    Get current runtime configuration.
    
    Args:
        include_sensitive: If True, includes the password (for internal use).
                           If False, returns safe version for API (default).
    
    Returns:
        Dict with config values
    """
    config = {
        'enabled': runtime_config['enabled'],
        'email': runtime_config['email'],
        'authenticated': runtime_config['authenticated'],
    }
    
    if include_sensitive:
        config['password'] = runtime_config['password']
    else:
        config['has_password'] = bool(runtime_config['password'])
        
    return config


def set_authenticated(value: bool) -> None:
    """Set the authenticated status."""
    global runtime_config
    runtime_config['authenticated'] = value
    logger.info(f"Runtime config: authenticated = {value}")

