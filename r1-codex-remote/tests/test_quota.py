"""실제 사용 창의 범위와 미제공 값을 보존하고 조회 프로토콜을 제한합니다."""
import io
import json
import unittest
from unittest.mock import Mock, patch

from companion.quota import normalize_quota, read_quota


class QuotaTests(unittest.TestCase):
    def test_codex_bucket_selected_and_other_model_budget_hidden(self):
        result = normalize_quota({'rateLimits': {'limitId': 'codex', 'primary': {'usedPercent': 50}},
                                 'rateLimitsByLimitId': {'base_model_inference': {'primary': {'usedPercent': 0}},
                                                       'codex': {'primary': {'usedPercent': 36, 'windowDurationMins': 10080, 'resetsAt': 1791601842}}}})
        self.assertEqual(result['windows'][0]['remainingPercent'], 64)
        self.assertEqual(result['windows'][0]['windowDurationMins'], 10080)
        self.assertEqual(result['windows'][0]['resetsAt'], 1791601842)
        self.assertEqual(len(result['windows']), 1)
        self.assertFalse(result['sameServerSameThreadProven'])

    def test_null_and_zero_are_distinct(self):
        unknown = normalize_quota({'rateLimits': {'primary': {'usedPercent': None}, 'secondary': None}})
        zero = normalize_quota({'rateLimits': {'primary': {'usedPercent': 0}}})
        self.assertIsNone(unknown['windows'][0]['remainingPercent'])
        self.assertEqual(zero['windows'][0]['remainingPercent'], 100)
        self.assertEqual(len(unknown['windows']), 1)

    def test_invalid_percentage_does_not_create_a_number(self):
        for value in (-1, 101, True, '36'):
            result = normalize_quota({'rateLimits': {'primary': {'usedPercent': value}}})
            self.assertIsNone(result['windows'][0]['remainingPercent'])

    def test_account_only_requests_and_private_fields_removed(self):
        messages = [
            {'id': 1, 'result': {'userAgent': 'test-server'}},
            {'id': 2, 'result': {'account': {'type': 'chatgpt', 'email': 'private@example.invalid'}}},
            {'id': 3, 'result': {'accountId': 'private-id', 'rateLimits': {'primary': {'usedPercent': 36}}}},
        ]
        class Writer(io.StringIO):
            def close(self):
                self.closed_by_reader = True
        process = Mock()
        writer = Writer()
        process.stdin = writer
        process.stdout = io.StringIO('\n'.join(json.dumps(item) for item in messages) + '\n')
        with patch('companion.quota.subprocess.Popen', return_value=process):
            result = read_quota()
        requests = [json.loads(line) for line in writer.getvalue().splitlines()]
        self.assertEqual([item['method'] for item in requests], ['initialize', 'initialized', 'account/read', 'account/rateLimits/read'])
        self.assertEqual(requests[2]['params'], {'refreshToken': False})
        self.assertEqual(result['windows'][0]['remainingPercent'], 64)
        self.assertNotIn('private@example.invalid', json.dumps(result))
        self.assertNotIn('private-id', json.dumps(result))
        self.assertTrue(writer.closed_by_reader)
        process.wait.assert_called()

    def test_api_key_mode_is_not_shown_as_subscription_quota(self):
        messages = [{'id': 1, 'result': {}}, {'id': 2, 'result': {'account': {'type': 'apiKey'}}}]
        process = Mock()
        process.stdin = io.StringIO()
        process.stdout = io.StringIO('\n'.join(json.dumps(item) for item in messages) + '\n')
        with patch('companion.quota.subprocess.Popen', return_value=process):
            result = read_quota()
        self.assertEqual(result['status'], 'unavailable')
        self.assertEqual(result['windows'], [])


if __name__ == '__main__':
    unittest.main()
