"""
Centralized logging utilities
"""

from datetime import datetime


def log(message: str, timestamp_format: str = "%H:%M:%S"):
    """Log message with timestamp
    
    Args:
        message: Message to log
        timestamp_format: Format string for timestamp
    """
    timestamp = datetime.now().strftime(timestamp_format)
    print(f"[{timestamp}] {message}")


def log_with_millis(message: str):
    """Log message with millisecond precision timestamp
    
    Args:
        message: Message to log
    """
    timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[{timestamp}] {message}")
