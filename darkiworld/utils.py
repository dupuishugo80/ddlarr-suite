"""
Utility functions for Darkiworld Scraper
Contains reusable helper functions.
"""

import re
import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


def parse_relative_date(date_str: str) -> int:
    """
    Convert date strings to timestamp for sorting
    Supports both ISO format (from API) and French relative dates
    Returns timestamp (higher = more recent)

    Examples:
    - "2025-07-02T10:06:28.000000Z" -> ISO timestamp
    - "l'année dernière" -> ~365 days ago
    - "il y a 3 mois" -> ~90 days ago
    - "il y a 5 jours" -> 5 days ago
    """
    if not date_str:
        return 0

    date_str_lower = date_str.lower().strip()

    # Try to parse ISO format first (from API)
    # Format: "2025-07-02T10:06:28.000000Z"
    try:
        # Handle both with and without microseconds
        if 'T' in date_str:
            # Remove Z and parse
            iso_str = date_str.replace('Z', '').split('.')[0]
            dt = datetime.strptime(iso_str, '%Y-%m-%dT%H:%M:%S')
            return int(dt.timestamp())
    except:
        pass

    # Parse French relative dates
    now = datetime.now()

    # "l'année dernière" or "l'an dernier"
    if "année" in date_str_lower or "l'an" in date_str_lower:
        return int((now - timedelta(days=365)).timestamp())

    # "il y a X mois"
    match = re.search(r'(\d+)\s*mois', date_str_lower)
    if match:
        months = int(match.group(1))
        return int((now - timedelta(days=months * 30)).timestamp())

    # "il y a X jours" or "il y a X jour"
    match = re.search(r'(\d+)\s*jours?', date_str_lower)
    if match:
        days = int(match.group(1))
        return int((now - timedelta(days=days)).timestamp())

    # "il y a X heures" or "il y a X heure"
    match = re.search(r'(\d+)\s*heures?', date_str_lower)
    if match:
        hours = int(match.group(1))
        return int((now - timedelta(hours=hours)).timestamp())

    # "il y a X minutes" or "il y a X minute"
    match = re.search(r'(\d+)\s*minutes?', date_str_lower)
    if match:
        minutes = int(match.group(1))
        return int((now - timedelta(minutes=minutes)).timestamp())

    # "aujourd'hui"
    if "aujourd'hui" in date_str_lower:
        return int(now.timestamp())

    # "hier"
    if "hier" in date_str_lower:
        return int((now - timedelta(days=1)).timestamp())

    # Default: very old (unknown format)
    return 0
