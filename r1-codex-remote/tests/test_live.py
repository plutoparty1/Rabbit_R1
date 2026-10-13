"""실시간 이벤트만 투영하고 원래 세션 증거를 따로 검증합니다."""
import unittest
from companion.live import LiveState


class LiveTests(unittest.TestCase):
    def setUp(self):
        self.state = LiveState('original')
        self.state.loaded(['original', 'other'])
        self.state.metadata({'id': 'original', 'name': '현재 작업', 'status': {'type': 'idle'},
                             'turns': [{'items': [{'type': 'agentMessage', 'text': '저장 이력'}]}]})

    def event(self, method, params):
        self.state.event({'method': method, 'params': params})

    def test_history_and_loaded_ids_are_not_live_proof(self):
        snapshot = self.state.snapshot()
        self.assertFalse(snapshot['sameServerSameThreadProven'])
        self.assertIsNone(snapshot['sessions'][0]['reply'])

    def test_delta_and_completed_item_do_not_duplicate_text(self):
        self.event('turn/started', {'threadId': 'original', 'turn': {'id': 'turn-1', 'status': 'inProgress'}})
        self.event('item/agentMessage/delta', {'threadId': 'original', 'turnId': 'turn-1', 'itemId': 'item-1', 'delta': '실제 응답'})
        self.event('item/completed', {'threadId': 'original', 'turnId': 'turn-1', 'item': {'type': 'agentMessage', 'id': 'item-1', 'text': '실제 응답'}})
        row = self.state.snapshot()['sessions'][0]
        self.assertEqual(row['reply'], '실제 응답')
        self.assertEqual(row['turnId'], 'turn-1')
        self.assertFalse(self.state.snapshot()['sameServerSameThreadProven'])

    def test_original_proof_requires_matching_pc_peer_and_live_event(self):
        self.state.pc_event_proof = ('t', 'i')
        self.event('item/agentMessage/delta', {'threadId': 'other', 'turnId': 't', 'itemId': 'i', 'delta': '다른 작업'})
        self.assertFalse(self.state.snapshot()['sameServerSameThreadProven'])
        self.event('item/agentMessage/delta', {'threadId': 'original', 'turnId': 't', 'itemId': 'i', 'delta': '원래 작업'})
        self.assertTrue(self.state.snapshot()['sameServerSameThreadProven'])

    def test_failure_interrupt_and_approval_are_distinct(self):
        for status, label in [('failed', '오류'), ('interrupted', '중단됨'), ('completed', '응답 완료')]:
            self.event('turn/completed', {'threadId': 'original', 'turn': {'id': 'turn-1', 'status': status}})
            self.assertEqual(self.state.snapshot()['sessions'][0]['status'], label)
        self.event('thread/status/changed', {'threadId': 'original', 'status': {'type': 'active', 'activeFlags': ['waitingOnApproval']}})
        self.assertEqual(self.state.snapshot()['sessions'][0]['status'], '승인 필요')

    def test_hidden_reasoning_and_unloaded_threads_are_ignored(self):
        self.event('item/reasoning/textDelta', {'threadId': 'original', 'delta': '숨겨진 내용'})
        self.event('item/agentMessage/delta', {'threadId': 'unloaded', 'turnId': 't', 'itemId': 'i', 'delta': '허용되지 않은 대화'})
        self.assertIsNone(self.state.snapshot()['sessions'][0]['reply'])
        self.assertEqual(len(self.state.snapshot()['sessions']), 2)

    def test_disconnect_invalidates_live_state_and_proof(self):
        self.state.pc_event_proof = ('t', 'i')
        self.event('item/agentMessage/delta', {'threadId': 'original', 'turnId': 't', 'itemId': 'i', 'delta': '응답'})
        self.state.disconnected()
        self.assertFalse(self.state.snapshot()['sameServerSameThreadProven'])
        self.assertIsNone(self.state.snapshot()['sessions'])

    def test_previous_pc_receipt_does_not_prove_a_new_reply(self):
        self.state.pc_event_proof = ('old-turn', 'old-item')
        self.event('item/agentMessage/delta', {'threadId': 'original', 'turnId': 'new-turn', 'itemId': 'new-item', 'delta': '새 응답'})
        self.assertFalse(self.state.snapshot()['sameServerSameThreadProven'])
        self.state.pc_event_proof = ('new-turn', 'new-item')
        self.assertTrue(self.state.snapshot()['sameServerSameThreadProven'])


if __name__ == '__main__':
    unittest.main()
