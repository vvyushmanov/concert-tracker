#!/usr/bin/env python3
"""
Test script for concerts-metal.com login automation

Demonstrates:
1. Rate limiting without authentication
2. Automated login flow
3. Authenticated access with cookies

This code can be integrated into HTTPClient or used as a standalone login module.
"""

import requests
import time
from typing import Optional, Dict


# Configuration constants
CONCERTS_METAL_BASE_URL = "https://en.concerts-metal.com"
CONCERTS_METAL_LOGIN_URL = f"{CONCERTS_METAL_BASE_URL}/login.html"
CONCERTS_METAL_EMAIL = ""
CONCERTS_METAL_PASSWORD = ""

# Detection constants
RATE_LIMIT_INDICATOR = "The access limit has been reached"
MIN_VALID_PAGE_SIZE = 100  # Valid pages are much larger than limit page


class ConcertsMetalAuthenticator:
    """
    Handles authentication for concerts-metal.com
    
    Can be integrated into HTTPClient or used standalone.
    """
    
    def __init__(
        self,
        email: str = CONCERTS_METAL_EMAIL,
        password: str = CONCERTS_METAL_PASSWORD,
        base_url: str = CONCERTS_METAL_BASE_URL
    ):
        """
        Initialize authenticator
        
        Args:
            email: Login email
            password: Login password
            base_url: Base URL for the site
        """
        self.email = email
        self.password = password
        self.base_url = base_url
        self.login_url = f"{base_url}/login.html"
        self.session = requests.Session()
        self._is_authenticated = False
    
    def is_rate_limited(self, response: requests.Response) -> bool:
        """
        Check if response indicates rate limiting
        
        Args:
            response: HTTP response to check
            
        Returns:
            True if rate limited, False otherwise
        """
        if response.status_code != 200:
            return False
        
        content = response.text
        
        # Check for rate limit message
        if RATE_LIMIT_INDICATOR in content:
            return True
        
        # Check for suspiciously small page size
        if len(content) < MIN_VALID_PAGE_SIZE:
            return True
        
        return False
    
    def login(self) -> bool:
        """
        Perform login and store authentication cookies in session
        
        Returns:
            True if login successful, False otherwise
        """
        try:
            # Step 1: Get initial session cookies
            print(f"[1/3] Getting initial session from {self.login_url}")
            init_response = self.session.get(self.login_url, timeout=15)
            
            if init_response.status_code != 200:
                print(f"❌ Failed to load login page: HTTP {init_response.status_code}")
                return False
            
            print(f"✓ Initial session established")
            print(f"  Cookies: {list(self.session.cookies.keys())}")
            
            # Step 2: Submit login form
            print(f"\n[2/3] Submitting login credentials")
            login_data = {
                'mail': self.email,
                'mdp': self.password,
                'remind': 'remind'  # Remember me checkbox
            }
            
            headers = {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': self.login_url,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            
            login_response = self.session.post(
                self.login_url,
                data=login_data,
                headers=headers,
                timeout=15,
                allow_redirects=True
            )
            
            if login_response.status_code != 200:
                print(f"❌ Login failed: HTTP {login_response.status_code}")
                return False
            
            # Step 3: Verify authentication cookies
            print(f"✓ Login request completed")
            print(f"  Cookies after login: {list(self.session.cookies.keys())}")
            
            # Check for authentication cookies
            has_login_cookie = 'login' in self.session.cookies
            has_auth_cookie = 'co' in self.session.cookies
            
            if has_login_cookie and has_auth_cookie:
                print(f"✓ Authentication cookies received:")
                print(f"  - login: {self.session.cookies.get('login')}")
                print(f"  - co: {self.session.cookies.get('co')}")
                self._is_authenticated = True
                return True
            else:
                print(f"❌ Authentication cookies not found")
                print(f"  Expected: 'login' and 'co'")
                print(f"  Got: {list(self.session.cookies.keys())}")
                return False
            
        except requests.RequestException as e:
            print(f"❌ Login error: {e}")
            return False
    
    def get(self, url: str, **kwargs) -> Optional[requests.Response]:
        """
        Make authenticated GET request
        
        Args:
            url: URL to fetch
            **kwargs: Additional arguments for requests.get
            
        Returns:
            Response object or None on failure
        """
        try:
            # Ensure we have proper headers
            if 'headers' not in kwargs:
                kwargs['headers'] = {}
            
            if 'User-Agent' not in kwargs['headers']:
                kwargs['headers']['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            
            # Set default timeout
            if 'timeout' not in kwargs:
                kwargs['timeout'] = 15
            
            response = self.session.get(url, **kwargs)
            return response
        except requests.RequestException as e:
            print(f"❌ Request error: {e}")
            return None
    
    def get_cookies_dict(self) -> Dict[str, str]:
        """
        Get current cookies as dictionary
        
        Returns:
            Dictionary of cookie name -> value
        """
        return dict(self.session.cookies)
    
    def is_authenticated(self) -> bool:
        """Check if currently authenticated"""
        return self._is_authenticated
    
    def close(self):
        """Close the session"""
        self.session.close()


def test_rotating_user_agents():
    """Test authenticated requests with rotating user agents"""
    
    print("\n" + "=" * 70)
    print("TEST 4: Multiple requests with rotating User-Agents")
    print("=" * 70)
    
    # User agents to test (similar to your parser's rotation)
    user_agents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
    
    # Login first
    auth = ConcertsMetalAuthenticator()
    if not auth.login():
        print("❌ Login failed - cannot test user agent rotation")
        return False
    
    print(f"\n✓ Logged in successfully")
    print(f"  Testing {len(user_agents)} different User-Agents...\n")
    
    # Test URLs (different pages to simulate real parsing)
    # Using pagination pages that actually exist
    test_urls = [
        CONCERTS_METAL_BASE_URL,
        f"{CONCERTS_METAL_BASE_URL}/next_fr_p2.html",
        f"{CONCERTS_METAL_BASE_URL}/next_fr_p3.html",
        f"{CONCERTS_METAL_BASE_URL}/next_fr_p4.html",
        f"{CONCERTS_METAL_BASE_URL}/next_fr_p5.html"
    ]
    
    success_count = 0
    
    for i, (url, user_agent) in enumerate(zip(test_urls, user_agents), 1):
        print(f"[Request {i}/{len(user_agents)}]")
        print(f"  URL: {url}")
        print(f"  User-Agent: {user_agent[:60]}...")
        
        # Make request with specific user agent
        response = auth.get(
            url,
            headers={'User-Agent': user_agent}
        )
        
        if response is None:
            print(f"  ❌ Request failed\n")
            continue
        
        # Check response
        is_limited = auth.is_rate_limited(response)
        content_size = len(response.text)
        
        print(f"  Status: HTTP {response.status_code}")
        print(f"  Size: {content_size:,} bytes")
        
        if is_limited:
            print(f"  ❌ RATE LIMITED - Authentication not working with this User-Agent")
        else:
            print(f"  ✓ SUCCESS - Full page loaded")
            success_count += 1
        
        print()
        
        # Small delay between requests (simulate real-world usage)
        if i < len(user_agents):
            time.sleep(0.5)
    
    auth.close()
    
    # Summary
    print(f"{'=' * 70}")
    print(f"ROTATION TEST SUMMARY")
    print(f"{'=' * 70}")
    print(f"Successful requests: {success_count}/{len(user_agents)}")
    
    if success_count == len(user_agents):
        print(f"✓ ALL USER-AGENTS WORK WITH AUTHENTICATION")
        return True
    elif success_count > 0:
        print(f"⚠ PARTIAL SUCCESS - Some user agents failed")
        return True
    else:
        print(f"❌ ALL REQUESTS FAILED")
        return False


def run_test():
    """Run the complete authentication test"""
    
    print("=" * 70)
    print("CONCERTS-METAL.COM AUTHENTICATION TEST")
    print("=" * 70)
    
    # Test 1: Request without authentication (should be rate limited)
    print("\n" + "=" * 70)
    print("TEST 1: Request main page WITHOUT authentication")
    print("=" * 70)
    
    try:
        response = requests.get(CONCERTS_METAL_BASE_URL, timeout=15)
        print(f"Status: HTTP {response.status_code}")
        print(f"Content length: {len(response.text)} bytes")
        
        if RATE_LIMIT_INDICATOR in response.text:
            print(f"✓ EXPECTED: Rate limit detected")
            print(f"  Message: '{RATE_LIMIT_INDICATOR}'")
        else:
            print(f"⚠ UNEXPECTED: No rate limit (might have valid cookies from browser)")
    except requests.RequestException as e:
        print(f"❌ Request failed: {e}")
        return False
    
    # Test 2: Login
    print("\n" + "=" * 70)
    print("TEST 2: Perform automated login")
    print("=" * 70)
    
    auth = ConcertsMetalAuthenticator()
    
    if not auth.login():
        print("\n❌ LOGIN FAILED - Cannot proceed with Test 3")
        return False
    
    print("\n✓ LOGIN SUCCESSFUL")
    
    # Test 3: Request with authentication
    print("\n" + "=" * 70)
    print("TEST 3: Request main page WITH authentication")
    print("=" * 70)
    
    print(f"Current cookies: {list(auth.get_cookies_dict().keys())}")
    
    response = auth.get(CONCERTS_METAL_BASE_URL, timeout=15)
    
    if response is None:
        print("❌ Request failed")
        auth.close()
        return False
    
    print(f"Status: HTTP {response.status_code}")
    print(f"Content length: {len(response.text)} bytes")
    print(f"Response URL: {response.url}")
    
    # Debug: Check response content
    if len(response.text) < 2000:
        print(f"\n[DEBUG] Response content (first 500 chars):")
        print(response.text[:500])
    
    if auth.is_rate_limited(response):
        print(f"❌ FAILED: Still rate limited after authentication")
        print(f"   This might be due to Cloudflare protection requiring browser-like behavior")
        auth.close()
        return False
    
    # Check for user profile indicators
    if 'logout' in response.text.lower() or 'profile' in response.text.lower():
        print(f"✓ SUCCESS: Authenticated page loaded")
        print(f"  - User profile elements detected")
        print(f"  - Page size: {len(response.text)} bytes (valid)")
    else:
        print(f"⚠ WARNING: Page loaded but user elements not found")
    
    # Display final cookies
    print(f"\n[FINAL STATE]")
    print(f"Authenticated: {auth.is_authenticated()}")
    print(f"Cookies: {list(auth.get_cookies_dict().keys())}")
    
    auth.close()
    
    print("\n" + "=" * 70)
    print("✓ BASIC TESTS COMPLETED SUCCESSFULLY")
    print("=" * 70)
    
    # Test 4: User agent rotation
    if not test_rotating_user_agents():
        print("\n⚠ User agent rotation test had issues")
        return False
    
    print("\n" + "=" * 70)
    print("✓ ALL TESTS COMPLETED SUCCESSFULLY")
    print("=" * 70)
    
    return True


if __name__ == "__main__":
    import sys
    success = run_test()
    sys.exit(0 if success else 1)
