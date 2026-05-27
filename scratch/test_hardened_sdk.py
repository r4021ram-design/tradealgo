import sys
from pathlib import Path

# Add project root to path
sys.path.append(str(Path(__file__).resolve().parents[1]))

from kotak_algo.exceptions import SessionExpiredError, OrderRejectedError, APIResponseError
from kotak_algo.utils.api_validator import (
    looks_like_session_expired,
    validate_positions_response,
    validate_order_response,
    validate_cancel_response,
)

def test_session_expiry_heuristics():
    print("Testing looks_like_session_expired...")
    # True positives (actual session issues)
    assert looks_like_session_expired("unauthorized") is True
    assert looks_like_session_expired("Session Expired") is True
    assert looks_like_session_expired("Invalid Token") is True
    assert looks_like_session_expired({"Error Message": "Complete the 2fa process before accessing this application"}) is True
    assert looks_like_session_expired({"errorMessage": "2fa process failed"}) is True
    assert looks_like_session_expired({"errMsg": "session expired"}) is True
    assert looks_like_session_expired("401 Unauthorized") is True
    
    # False positives (should NOT trigger session expired)
    # The word "expired" inside general option metadata should be fine now
    assert looks_like_session_expired("Option expired on 26-May") is False
    assert looks_like_session_expired({"tradingSymbol": "NIFTY26MAY24200CE", "expiryState": "expired"}) is False
    assert looks_like_session_expired({"expiry": "expired"}) is False
    assert looks_like_session_expired({"status": "expired"}) is False
    assert looks_like_session_expired(None) is False
    print("[OK] Session expiry heuristics passed!")

def test_positions_validation():
    print("Testing validate_positions_response...")
    # 1. Valid list response
    positions_list = [{"trdSym": "NIFTY26MAY24200CE", "flBuyQty": "75"}]
    assert validate_positions_response(positions_list) == positions_list
    
    # 2. Valid dictionary nested data response
    positions_dict = {"stat": "ok", "data": [{"trdSym": "NIFTY26MAY24200CE", "flBuyQty": "75"}]}
    assert validate_positions_response(positions_dict) == [{"trdSym": "NIFTY26MAY24200CE", "flBuyQty": "75"}]
    
    # 3. Unauthenticated/Expired 2FA response (should raise SessionExpiredError)
    unauth_response = {"Error Message": "Complete the 2fa process before accessing this application"}
    try:
        validate_positions_response(unauth_response)
        assert False, "Should raise SessionExpiredError for 2FA"
    except SessionExpiredError:
        pass
        
    # 4. Benign "No Positions Found" or "No Data Found" dictionary (should return empty list)
    empty_res1 = {"stat": "Not_Ok", "errMsg": "No positions found"}
    empty_res2 = {"stat": "Not_Ok", "message": "No data found"}
    empty_res3 = {"Error Message": "No record found"}
    assert validate_positions_response(empty_res1) == []
    assert validate_positions_response(empty_res2) == []
    assert validate_positions_response(empty_res3) == []
    assert validate_positions_response(None) == []
    
    # 5. Invalid dict or type (should raise APIResponseError)
    invalid_dict = {"stat": "ok", "custom_field": "some_value"}
    try:
        validate_positions_response(invalid_dict)
        assert False, "Should raise APIResponseError for malformed response"
    except APIResponseError:
        pass
    print("[OK] Positions validation passed!")

def test_order_validation():
    print("Testing validate_order_response...")
    # 1. Successful order responses
    assert validate_order_response("123456") == "123456"
    assert validate_order_response({"stat": "Ok", "nOrdNo": "123456"}) == "123456"
    assert validate_order_response({"stat": "Ok", "data": {"orderId": "123456"}}) == "123456"
    
    # 2. Rejection response
    reject_response = {"stat": "Not_Ok", "errMsg": "insufficient balance"}
    try:
        validate_order_response(reject_response)
        assert False, "Should raise OrderRejectedError"
    except OrderRejectedError as e:
        assert "Margin shortfall" in str(e)

    # 3. Session Expired
    try:
        validate_order_response({"Error Message": "Complete the 2fa process"})
        assert False, "Should raise SessionExpiredError"
    except SessionExpiredError:
        pass
    print("[OK] Order validation passed!")

def test_cancel_validation():
    print("Testing validate_cancel_response...")
    # 1. Successful cancel responses
    assert validate_cancel_response({"stat": "Ok", "nOrdNo": "123456"}) == "123456"
    assert validate_cancel_response("123456") == "123456"
    
    # 2. Benign cancel failures (order already filled/cancelled) -> should return status code or id, no error
    already_filled = {"stat": "Not_Ok", "errMsg": "Order is already filled"}
    assert validate_cancel_response(already_filled) == "benign_failure"
    
    already_cancelled = {"stat": "Not_Ok", "errMsg": "Order is already cancelled", "nOrdNo": "123456"}
    assert validate_cancel_response(already_cancelled) == "123456"
    
    # 3. Serious cancel rejection
    reject_cancel = {"stat": "Not_Ok", "errMsg": "RMS block limit exceeded"}
    try:
        validate_cancel_response(reject_cancel)
        assert False, "Should raise OrderRejectedError"
    except OrderRejectedError as e:
        assert "Cancel order rejected" in str(e)
    print("[OK] Cancel validation passed!")

def run_tests():
    print("Running Kotak Neo API SDK hardening verification tests...\n")
    test_session_expiry_heuristics()
    print()
    test_positions_validation()
    print()
    test_order_validation()
    print()
    test_cancel_validation()
    print("\n=== ALL HARDENED INTEGRATION TESTS PASSED SUCCESSFULLY! ===")

if __name__ == "__main__":
    run_tests()
