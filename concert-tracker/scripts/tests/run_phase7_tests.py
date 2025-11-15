#!/usr/bin/env python3
"""
Master test runner for Phase 7: Testing & Validation

Runs all integration tests for Last.fm Optional refactoring:
- Scenario B: UserArtist only (no Last.fm)
- Scenario C: No sources (error handling)
- Scenario D: --no-filter mode
- Scenario E: fetch_metadata.py without Last.fm

Usage:
    python run_phase7_tests.py [--verbose]
"""

import sys
import os
import subprocess
import time

# Test files to run
TESTS = [
    {
        'name': 'Scenario B: UserArtist Only',
        'file': 'test_scenario_b_userartist_only.py',
        'description': 'Tests system with UserArtist table but no Last.fm'
    },
    {
        'name': 'Scenario C: No Sources',
        'file': 'test_scenario_c_no_sources.py',
        'description': 'Tests error handling when no artist sources available'
    },
    {
        'name': 'Scenario D: No-Filter Mode',
        'file': 'test_scenario_d_no_filter.py',
        'description': 'Tests --no-filter mode (fetch all concerts)'
    },
    {
        'name': 'Scenario E: Metadata Without Last.fm',
        'file': 'test_scenario_e_metadata_no_lastfm.py',
        'description': 'Tests metadata fetching with only MusicBrainz'
    }
]


def print_header(text, char='='):
    """Print centered header"""
    width = 80
    print(f"\n{char * width}")
    print(f"{text.center(width)}")
    print(f"{char * width}\n")


def run_test(test_info, verbose=False):
    """Run a single test file"""
    print(f"Running: {test_info['name']}")
    print(f"Description: {test_info['description']}")
    print(f"File: {test_info['file']}")
    print("-" * 80)

    test_path = os.path.join(os.path.dirname(__file__), test_info['file'])

    if not os.path.exists(test_path):
        print(f"❌ ERROR: Test file not found: {test_path}")
        return False

    # Run test
    start_time = time.time()

    try:
        result = subprocess.run(
            [sys.executable, test_path],
            cwd=os.path.dirname(test_path),
            capture_output=not verbose,
            text=True,
            timeout=300  # 5 minute timeout
        )

        elapsed = time.time() - start_time

        if result.returncode == 0:
            print(f"✅ PASSED (in {elapsed:.2f}s)")
            if verbose and result.stdout:
                print("\nTest output:")
                print(result.stdout)
            return True
        else:
            print(f"❌ FAILED (exit code: {result.returncode}, time: {elapsed:.2f}s)")
            if result.stdout:
                print("\nStdout:")
                print(result.stdout)
            if result.stderr:
                print("\nStderr:")
                print(result.stderr)
            return False

    except subprocess.TimeoutExpired:
        elapsed = time.time() - start_time
        print(f"❌ TIMEOUT (exceeded {elapsed:.2f}s)")
        return False

    except Exception as e:
        elapsed = time.time() - start_time
        print(f"❌ ERROR: {e} (after {elapsed:.2f}s)")
        return False


def main():
    """Main test runner"""
    verbose = '--verbose' in sys.argv or '-v' in sys.argv

    print_header("PHASE 7: Testing & Validation", '=')
    print("Last.fm Optional Refactoring - Integration Test Suite")
    print(f"Total tests: {len(TESTS)}")
    print(f"Verbose mode: {'ON' if verbose else 'OFF'}")

    results = []
    start_time = time.time()

    for i, test in enumerate(TESTS, 1):
        print_header(f"Test {i}/{len(TESTS)}: {test['name']}", '-')
        success = run_test(test, verbose)
        results.append({
            'test': test['name'],
            'success': success
        })
        print()

    # Print summary
    total_time = time.time() - start_time
    print_header("TEST SUMMARY", '=')

    passed = sum(1 for r in results if r['success'])
    failed = len(results) - passed

    print(f"Total tests run: {len(results)}")
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")
    print(f"Success rate: {(passed/len(results)*100):.1f}%")
    print(f"Total time: {total_time:.2f}s")

    print("\nDetailed results:")
    for i, result in enumerate(results, 1):
        status = "✅ PASS" if result['success'] else "❌ FAIL"
        print(f"  {i}. {status} - {result['test']}")

    if failed == 0:
        print_header("🎉 ALL TESTS PASSED! 🎉", '=')
        return 0
    else:
        print_header(f"⚠️  {failed} TEST(S) FAILED", '=')
        return 1


if __name__ == '__main__':
    exit_code = main()
    sys.exit(exit_code)
