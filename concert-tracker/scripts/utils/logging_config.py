"""
Centralized logging configuration for concert tracker scripts.

Usage:
    from utils.logging_config import get_logger, setup_logging

    # Setup logging (call once at script start)
    setup_logging(verbose=args.verbose)

    # Get logger for your module
    logger = get_logger(__name__)
    logger.info("Processing started")
    logger.warning("No artists found")
    logger.error("Database connection failed", exc_info=True)
"""

import logging
import sys
from typing import Optional


class LogColors:
    """ANSI color codes for terminal output"""
    RESET = '\033[0m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    GREEN = '\033[92m'
    BLUE = '\033[94m'
    GRAY = '\033[90m'
    BOLD = '\033[1m'


class ColoredFormatter(logging.Formatter):
    """Custom formatter with colors for terminal output"""

    COLORS = {
        logging.DEBUG: LogColors.GRAY,
        logging.INFO: LogColors.BLUE,
        logging.WARNING: LogColors.YELLOW,
        logging.ERROR: LogColors.RED,
        logging.CRITICAL: LogColors.RED + LogColors.BOLD,
    }

    def format(self, record):
        # Apply color to level name
        color = self.COLORS.get(record.levelno, LogColors.RESET)
        record.levelname = f"{color}{record.levelname}{LogColors.RESET}"
        return super().format(record)


def setup_logging(
    level: int = logging.INFO,
    log_file: Optional[str] = None,
    verbose: bool = False,
    format_string: Optional[str] = None
) -> None:
    """
    Configure logging for the application.

    Args:
        level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_file: Optional file path to write logs to
        verbose: If True, set level to DEBUG
        format_string: Optional custom format string
    """
    if verbose:
        level = logging.DEBUG

    # Default format strings
    console_format = format_string or '%(levelname)s: %(message)s'
    file_format = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'

    # Create formatters
    console_formatter = ColoredFormatter(console_format)
    file_formatter = logging.Formatter(file_format, datefmt='%Y-%m-%d %H:%M:%S')

    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(level)

    # Remove existing handlers to avoid duplicates
    root_logger.handlers.clear()

    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(level)
    console_handler.setFormatter(console_formatter)
    root_logger.addHandler(console_handler)

    # File handler (optional)
    if log_file:
        file_handler = logging.FileHandler(log_file)
        file_handler.setLevel(logging.DEBUG)  # Always log everything to file
        file_handler.setFormatter(file_formatter)
        root_logger.addHandler(file_handler)


def get_logger(name: str) -> logging.Logger:
    """
    Get a logger instance for a module.

    Args:
        name: Logger name (typically __name__)

    Returns:
        Logger instance
    """
    return logging.getLogger(name)


# Convenience functions for backward compatibility with print()
def info(msg: str) -> None:
    """Print info message (backward compatible with print())"""
    logging.getLogger().info(msg)


def warning(msg: str) -> None:
    """Print warning message"""
    logging.getLogger().warning(msg)


def error(msg: str) -> None:
    """Print error message"""
    logging.getLogger().error(msg)


def debug(msg: str) -> None:
    """Print debug message"""
    logging.getLogger().debug(msg)


if __name__ == '__main__':
    # Test the logging module
    setup_logging(verbose=True)
    logger = get_logger(__name__)

    print("\n=== Logging Configuration Test ===\n")

    logger.debug("This is a DEBUG message")
    logger.info("This is an INFO message")
    logger.warning("This is a WARNING message")
    logger.error("This is an ERROR message")
    logger.critical("This is a CRITICAL message")

    print("\n=== Test with convenience functions ===\n")

    debug("Debug via convenience function")
    info("Info via convenience function")
    warning("Warning via convenience function")
    error("Error via convenience function")

    print("\n=== Logging test complete ===")
