"""
Chrome Driver module for Darkiworld Scraper using SeleniumBase
"""

import threading
import logging
from seleniumbase import SB

logger = logging.getLogger(__name__)

# Global driver instance and context manager
_sb_instance = None
_context_manager = None
_driver_lock = threading.Lock()


class SBWrapper:
    """Wrapper to keep SB context manager alive"""
    def __init__(self):
        self.cm = SB(uc=True, headless=False, test=True)
        self.sb = self.cm.__enter__()

    def __getattr__(self, name):
        """Delegate all attribute access to the SB instance"""
        return getattr(self.sb, name)

    def close(self):
        """Close the context manager"""
        try:
            # Try to quit driver directly first
            if hasattr(self, 'sb') and hasattr(self.sb, 'driver'):
                self.sb.driver.quit()
        except:
            pass

        try:
            # Then close context manager
            self.cm.__exit__(None, None, None)
        except:
            pass


def get_driver():
    """Get or create a singleton SeleniumBase driver instance"""
    global _sb_instance

    with _driver_lock:
        if _sb_instance is None:
            logger.info("Creating new SeleniumBase driver with UC mode...")
            _sb_instance = SBWrapper()
            logger.info("✓ SeleniumBase driver created")

        return _sb_instance


def close_driver():
    """Close the SeleniumBase driver if it exists"""
    global _sb_instance

    with _driver_lock:
        if _sb_instance is not None:
            logger.info("Closing SeleniumBase driver...")
            try:
                # Try to quit the underlying driver first
                if hasattr(_sb_instance, 'driver') and _sb_instance.driver:
                    try:
                        _sb_instance.driver.quit()
                        logger.info("✓ Driver quit successfully")
                    except Exception as e:
                        logger.debug(f"Error quitting driver: {e}")

                # Close the context manager
                _sb_instance.close()
                logger.info("✓ Context manager closed")
            except Exception as e:
                logger.warning(f"Error during driver cleanup: {e}")
            finally:
                _sb_instance = None
                logger.info("✓ Driver instance cleared")
