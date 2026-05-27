import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kotak_algo.core.position_tracker import parse_expiry

test_cases = [
    # (expiry_clean_str, underlying, expected_date)
    ("26MAY", "NIFTY", "2026-05-26"),
    ("26MAY", "BANKNIFTY", "2026-05-26"),
    ("26MAY", "SENSEX", "2026-05-27"),  # Holiday on May 28, shifts to May 27
    ("26JUN", "NIFTY", "2026-06-30"),  # Last Tuesday of June
    ("26JUN", "SENSEX", "2026-06-25"), # Last Thursday of June (June 25)
    ("26MAY26", "NIFTY", "2026-05-26"),
    ("26MAY28", "SENSEX", "2026-05-27"), # Weekly on holiday day, shifts to May 27
]

print("=== RUNNING EXPIRY PARSER TESTS ===")
all_passed = True
for exp_str, und, expected in test_cases:
    res = parse_expiry(exp_str, und)
    res_str = res.strftime("%Y-%m-%d")
    status = "PASS" if res_str == expected else f"FAIL (Got {res_str})"
    print(f"[{status}] {und:10s} {exp_str:8s} -> {res_str} (Expected: {expected})")
    if res_str != expected:
        all_passed = False

if all_passed:
    print("\nALL TESTS PASSED!")
else:
    print("\nSOME TESTS FAILED!")
