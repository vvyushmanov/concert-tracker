"""
Rate limiting utilities
"""

import time
import random


def interruptible_sleep(duration: float, shutdown_flag, check_interval: float = 0.1) -> bool:
    """Sleep for duration, but check shutdown flag periodically.

    Args:
        duration: Total sleep time in seconds
        shutdown_flag: GracefulShutdown object to check for interrupts
        check_interval: How often to check the flag (default 0.1s)

    Returns:
        True if sleep completed normally, False if interrupted
    """
    elapsed = 0.0
    while elapsed < duration:
        if shutdown_flag.interrupted:
            return False
        sleep_time = min(check_interval, duration - elapsed)
        time.sleep(sleep_time)
        elapsed += sleep_time
    return True


class RateLimiter:
    """Simple rate limiter with randomization and interruptible waits"""

    # Check interval for interrupt flag (in seconds)
    INTERRUPT_CHECK_INTERVAL = 0.1

    def __init__(self, base_delay: float = 1.0, randomness: float = 0.5, shutdown_flag=None):
        """Initialize rate limiter

        Args:
            base_delay: Base delay in seconds
            randomness: Random variation factor (0.0 to 1.0)
            shutdown_flag: Optional GracefulShutdown object to check for interrupts
        """
        self.base_delay = base_delay
        self.randomness = randomness
        self.shutdown_flag = shutdown_flag

    def wait(self, multiplier: float = 1.0) -> bool:
        """Wait with random variation, interruptible by shutdown flag

        Args:
            multiplier: Multiply base delay by this factor

        Returns:
            True if wait completed normally, False if interrupted
        """
        delay = self._calculate_delay(self.base_delay * multiplier)

        # If no shutdown flag, use simple sleep
        if not self.shutdown_flag:
            time.sleep(delay)
            return True

        # Interruptible sleep: check shutdown flag periodically
        elapsed = 0.0
        while elapsed < delay:
            if self.shutdown_flag.interrupted:
                return False

            # Sleep in small chunks
            sleep_time = min(self.INTERRUPT_CHECK_INTERVAL, delay - elapsed)
            time.sleep(sleep_time)
            elapsed += sleep_time

        return True
    
    def _calculate_delay(self, base: float) -> float:
        """Calculate delay with random variation
        
        Args:
            base: Base delay value
            
        Returns:
            Delay with random variation applied
        """
        variation = base * self.randomness
        return base + random.uniform(-variation, variation)
