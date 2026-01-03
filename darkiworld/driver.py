"""
Chrome Driver module for Darkiworld Scraper
Manages the Chrome driver singleton with anti-detection stealth scripts.
"""

import threading
import logging
import undetected_chromedriver as uc

logger = logging.getLogger(__name__)

# Global driver instance
_driver = None
_driver_lock = threading.Lock()


def get_driver():
    """Get or create a singleton Chrome driver instance"""
    global _driver

    with _driver_lock:
        if _driver is None:
            logger.info("Creating new undetected Chrome driver...")

            options = uc.ChromeOptions()
            # Set Chrome binary location
            options.binary_location = '/usr/bin/google-chrome'
            # Enable headless mode
            options.add_argument('--headless=new')
            options.add_argument('--no-sandbox')
            options.add_argument('--disable-dev-shm-usage')
            options.add_argument('--disable-blink-features=AutomationControlled')
            options.add_argument('--disable-web-security')
            options.add_argument('--disable-features=IsolateOrigins,site-per-process')
            options.add_argument('--disable-infobars')
            options.add_argument('--disable-extensions')
            options.add_argument('--disable-gpu')
            options.add_argument('--window-size=1920,1080')
            options.add_argument('--start-maximized')
            # Use Chrome user agent
            options.add_argument('--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')

            _driver = uc.Chrome(options=options, use_subprocess=True)

            # Execute CDP commands to further mask automation with advanced stealth
            _driver.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument', {
                'source': '''
                    // Navigator properties
                    Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
                    Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
                    Object.defineProperty(navigator, 'languages', {get: () => ['fr-FR', 'fr', 'en-US', 'en']});
                    Object.defineProperty(navigator, 'maxTouchPoints', {get: () => 1});
                    Object.defineProperty(navigator, 'platform', {get: () => 'Win32'});
                    Object.defineProperty(navigator, 'vendor', {get: () => 'Google Inc.'});
                    Object.defineProperty(navigator, 'hardwareConcurrency', {get: () => 8});
                    Object.defineProperty(navigator, 'deviceMemory', {get: () => 8});

                    // Chrome object
                    window.chrome = {
                        runtime: {},
                        loadTimes: function() {},
                        csi: function() {},
                        app: {}
                    };

                    // Remove automation flags
                    delete navigator.__proto__.webdriver;

                    // Canvas fingerprint protection
                    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
                    HTMLCanvasElement.prototype.toDataURL = function(type) {
                        if (type === 'image/png' && this.width === 280 && this.height === 60) {
                            return originalToDataURL.apply(this, arguments);
                        }
                        return originalToDataURL.apply(this, arguments);
                    };

                    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
                    CanvasRenderingContext2D.prototype.getImageData = function() {
                        return originalGetImageData.apply(this, arguments);
                    };

                    // WebGL fingerprint protection
                    const getParameter = WebGLRenderingContext.prototype.getParameter;
                    WebGLRenderingContext.prototype.getParameter = function(parameter) {
                        if (parameter === 37445) {
                            return 'Intel Inc.';
                        }
                        if (parameter === 37446) {
                            return 'Intel Iris OpenGL Engine';
                        }
                        return getParameter.apply(this, arguments);
                    };

                    // Audio fingerprint protection
                    const audioContext = window.AudioContext || window.webkitAudioContext;
                    if (audioContext) {
                        const OriginalAudioContext = audioContext;
                        window.AudioContext = function() {
                            const ctx = new OriginalAudioContext();
                            const originalGetChannelData = AudioBuffer.prototype.getChannelData;
                            AudioBuffer.prototype.getChannelData = function() {
                                const data = originalGetChannelData.apply(this, arguments);
                                return data;
                            };
                            return ctx;
                        };
                    }

                    // Permissions
                    const originalQuery = window.navigator.permissions.query;
                    window.navigator.permissions.query = (parameters) => (
                        parameters.name === 'notifications' ?
                            Promise.resolve({ state: Notification.permission }) :
                            originalQuery(parameters)
                    );

                    // Chrome runtime
                    Object.defineProperty(navigator, 'connection', {
                        get: () => ({
                            effectiveType: '4g',
                            rtt: 50,
                            downlink: 10,
                            saveData: false
                        })
                    });

                    // Remove Selenium/WebDriver traces
                    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
                    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
                    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;

                    // Screen properties
                    Object.defineProperty(window.screen, 'availWidth', {get: () => 1920});
                    Object.defineProperty(window.screen, 'availHeight', {get: () => 1040});
                    Object.defineProperty(window.screen, 'width', {get: () => 1920});
                    Object.defineProperty(window.screen, 'height', {get: () => 1080});
                '''
            })

            logger.info("✓ Undetected Chrome driver created with stealth scripts")

        return _driver


def close_driver():
    """Close the Chrome driver if it exists"""
    global _driver
    
    with _driver_lock:
        if _driver is not None:
            logger.info("Closing Chrome driver...")
            _driver.quit()
            _driver = None
