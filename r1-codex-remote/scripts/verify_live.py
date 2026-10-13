"""전용 시험 대화에서 두 클라이언트의 실제 동일 응답 이벤트를 확인합니다."""
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path

from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus

from companion.live import LiveState, RpcConnection

ROOT = Path(__file__).resolve().parents[1]


async def verify():
    config = json.loads((ROOT / '.runtime/shared-server.json').read_text(encoding='utf-8'))
    token = (ROOT / '.runtime/shared-token.txt').read_text(encoding='utf-8').strip()
    endpoint = config['endpoint']
    try:
        async with connect(endpoint, additional_headers={'Authorization': 'Bearer invalid'}, proxy=None):
            raise AssertionError('인증되지 않은 서버 접근이 허용되었습니다.')
    except InvalidStatus as error:
        assert error.response.status_code in (401, 403)
    workspace = ROOT / '.runtime/protocol-test'
    workspace.mkdir(exist_ok=True)
    # 시험 작업 공간은 대화 재확인용 자료이며 임시 녹음·캐시와 분리합니다.
    events = [[], []]
    completed = asyncio.Event()
    pc_completed = asyncio.Event()
    state = LiveState('not-the-original-thread')
    def collect(index, message):
        method = message.get('method')
        if method in ('item/agentMessage/delta', 'item/completed', 'turn/completed'):
            events[index].append(message)
        if index == 1:
            state.event(message)
            if method == 'turn/completed':
                completed.set()
        elif method == 'turn/completed':
            pc_completed.set()
    async with connect(endpoint, additional_headers={'Authorization': 'Bearer ' + token}, proxy=None) as pc_socket, \
            connect(endpoint, additional_headers={'Authorization': 'Bearer ' + token}, proxy=None) as bridge_socket:
        pc = RpcConnection(pc_socket, lambda message: collect(0, message))
        bridge = RpcConnection(bridge_socket, lambda message: collect(1, message))
        readers = [asyncio.create_task(pc.receive()), asyncio.create_task(bridge.receive())]
        try:
            await pc.initialize('r1_pc_verification_client')
            await bridge.initialize('r1_bridge_verification_client')
            result = await pc.request('thread/start', {'cwd': str(workspace)})
            thread_id = result['thread']['id']
            # 설치 버전은 첫 턴 전에는 rollout이 없어 다른 클라이언트의 resume를 거부합니다.
            await pc.request('turn/start', {'threadId': thread_id, 'input': [
                {'type': 'text', 'text': '연결 준비 시험입니다. 도구·파일·명령은 사용하지 말고 “준비 완료”라는 한 문장만 답해 주세요.'}]})
            await asyncio.wait_for(pc_completed.wait(), timeout=90)
            events[0].clear()
            pc_completed.clear()
            loaded = await bridge.request('thread/loaded/list')
            assert thread_id in loaded['data']
            state.loaded([thread_id])
            try:
                resumed = await bridge.request('thread/resume', {'threadId': thread_id, 'excludeTurns': True})
            except RuntimeError as error:
                print(json.dumps({'stage': 'loaded_thread_subscribe', 'rpcCode': getattr(error, 'rpc_code', None),
                                  'rpcMessage': getattr(error, 'rpc_message', None)}, ensure_ascii=False))
                raise
            state.metadata(resumed['thread'])
            turn = await pc.request('turn/start', {'threadId': thread_id, 'input': [
                {'type': 'text', 'text': '연결 검증입니다. 도구·파일·명령은 사용하지 말고 “실시간 연결 시험 완료”라는 한 문장만 답해 주세요.'}]})
            turn_id = turn['turn']['id']
            await asyncio.wait_for(completed.wait(), timeout=90)
            def final_items(messages):
                return [(m['params']['threadId'], m['params']['turnId'], m['params']['item']['id'], m['params']['item'].get('text', ''))
                        for m in messages if m['method'] == 'item/completed' and m['params'].get('item', {}).get('type') == 'agentMessage']
            pc_items, bridge_items = final_items(events[0]), final_items(events[1])
            assert pc_items and pc_items == bridge_items
            assert all(item[0] == thread_id and item[1] == turn_id for item in pc_items)
            final_status = next(m['params']['turn']['status'] for m in events[1] if m['method'] == 'turn/completed')
            assert final_status == 'completed'
            assert not state.snapshot()['sameServerSameThreadProven']
            report = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'result': 'PASS', 'endpoint': endpoint,
                      'scope': 'dedicated_test_thread', 'threadId': thread_id, 'turnId': turn_id,
                      'matchedAgentItems': [{'itemId': item[2], 'text': item[3]} for item in pc_items],
                      'twoRpcClientsMatched': True, 'pcTuiVerified': False, 'originalThreadVerified': False,
                      'modelTurnsStarted': 2}
            (ROOT / 'docs/live-protocol-test.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            (ROOT / '.runtime/test-thread.json').write_text(json.dumps({'threadId': thread_id, 'cwd': str(workspace)}), encoding='utf-8')
            print(json.dumps(report, ensure_ascii=False))
        finally:
            for reader in readers:
                reader.cancel()
            await asyncio.gather(*readers, return_exceptions=True)


if __name__ == '__main__':
    asyncio.run(verify())
