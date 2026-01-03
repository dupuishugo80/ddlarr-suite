"""
AllDebrid integration module for Darkiworld Scraper
Handles link debriding via AllDebrid API.
"""

import logging
from typing import Optional
import requests
from config import ALLDEBRID_API_KEY, ALLDEBRID_API_URL

logger = logging.getLogger(__name__)


def debrid_link(link: str) -> Optional[str]:
    """
    Debrid a single link using AllDebrid API
    
    Args:
        link: The original download link to debrid
        
    Returns:
        Debrided link URL or None if failed/link is down
    """
    if not ALLDEBRID_API_KEY:
        logger.warning("⚠️ ALLDEBRID_KEY not configured in .env")
        return None
    
    if not link:
        return None
    
    try:
        logger.info(f"Debriding link: {link[:50]}...")
        
        response = requests.get(
            ALLDEBRID_API_URL,
            params={'link': link, 'agent': 'darkiworld-scraper'},
            headers={
                'Authorization': f'Bearer {ALLDEBRID_API_KEY}',
                'Accept': 'application/json'
            },
            timeout=30
        )
        
        data = response.json()
        
        # Check for API errors
        if data.get('status') != 'success':
            error = data.get('error', {})
            error_code = error.get('code', 'UNKNOWN')
            error_message = error.get('message', 'Unknown error')
            
            # LINK_DOWN means the file is no longer available
            if error_code == 'LINK_DOWN':
                logger.warning(f"⚠️ Link is down (unavailable): {link[:50]}...")
                return None
            
            logger.error(f"❌ AllDebrid API error: {error_code} - {error_message}")
            return None
        
        # Extract debrided link
        debrided_data = data.get('data', {})
        debrided_link = debrided_data.get('link')
        
        if debrided_link:
            logger.info(f"✓ Successfully debrided link")
            return debrided_link
        else:
            logger.warning(f"⚠️ No debrided link in response")
            return None
            
    except requests.exceptions.Timeout:
        logger.error(f"❌ AllDebrid API timeout for link: {link[:50]}...")
        return None
    except requests.exceptions.RequestException as e:
        logger.error(f"❌ AllDebrid API request error: {e}")
        return None
    except Exception as e:
        logger.error(f"❌ Error debriding link: {e}")
        return None


def debrid_links(links: dict) -> dict:
    """
    Debrid multiple links using AllDebrid API
    
    Args:
        links: Dictionary mapping release_id -> download link
        
    Returns:
        Dictionary mapping release_id -> debrided link (only successful ones)
    """
    debrided = {}
    
    if not ALLDEBRID_API_KEY:
        logger.warning("⚠️ ALLDEBRID_KEY not configured - skipping debrid")
        return links  # Return original links if no API key
    
    logger.info(f"🔓 Debriding {len(links)} links with AllDebrid...")
    
    for release_id, link in links.items():
        if not link:
            continue
            
        debrided_result = debrid_link(link)
        
        if debrided_result:
            debrided[release_id] = debrided_result
        # Links that fail (including LINK_DOWN) are not included in result
    
    logger.info(f"✅ Successfully debrided {len(debrided)}/{len(links)} links")
    return debrided
