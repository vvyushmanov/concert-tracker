"""
Rate limiting utilities
"""

import time
import random


class RateLimiter:
    """Simple rate limiter with randomization"""
    
    def __init__(self, base_delay: float = 1.0, randomness: float = 0.5):
        """Initialize rate limiter
        
        Args:
            base_delay: Base delay in seconds
            randomness: Random variation factor (0.0 to 1.0)
        """
        self.base_delay = base_delay
        self.randomness = randomness
    
    def wait(self, multiplier: float = 1.0):
        """Wait with random variation
        
        Args:
            multiplier: Multiply base delay by this factor
        """
        delay = self._calculate_delay(self.base_delay * multiplier)
        time.sleep(delay)
    
    def _calculate_delay(self, base: float) -> float:
        """Calculate delay with random variation
        
        Args:
            base: Base delay value
            
        Returns:
            Delay with random variation applied
        """
        variation = base * self.randomness
        return base + random.uniform(-variation, variation)
