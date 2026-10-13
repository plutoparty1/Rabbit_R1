"""이미 연결된 전용 PC TUI의 다음 턴을 두 RPC 관찰자로 비교합니다."""
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path

from websockets.asyncio.client import connect
from companion.live import RpcConnection

ROOT = Path(__file__).resolve().parents[1]


async def verify():
    info = json.loads((ROOT / '.runtime/test-thread.json').read_text(encoding='utf-8'))
    token = (ROOT / '.runtime/shared-token.txt').read_text(encoding='utf-8').strip()
    endpoint = 'ws://127.0.0.1:4500'
    events = [[], []]
    done = asyncio.Event()
    def event(index, message):
        if message.get('method') in ('item/agentMessage/delta', 'item/completed', 'turn/completed'):
            events[index].append(message)
        if index == 1 and message.get('method') == 'turn/completed':
            done.set()
    async with connect(endpoint, additional_headers={'Authorization': 'Bearer ' + token}, proxy=None) as one, \
            connect(endpoint, additional_headers={'Authorization': 'Bearer ' + token}, proxy=None) as two:
        pc = RpcConnection(one, lambda message: event(0, message))
        bridge = RpcConnection(two, lambda message: event(1, message))
        readers = [asyncio.create_task(pc.receive()), asyncio.create_task(bridge.receive())]
        try:
            await pc.initialize('r1_pc_tui_observer')
            await bridge.initialize('r1_tui_bridge_observer')
            loaded = await pc.request('thread/loaded/list')
            assert info['threadId'] in loaded['data']
            for client in (pc, bridge):
                await client.request('thread/resume', {'threadId': info['threadId'], 'excludeTurns': True})
            turn = await pc.request('turn/start', {'threadId': info['threadId'], 'input': [
                {'type': 'text', 'text': '도구·파일·명령은 사용하지 마세요. 219 더하기 375의 합계를 “검증 숫자: 합계” 형식의 한 문장으로 답해 주세요.'}]})
            await asyncio.wait_for(done.wait(), timeout=90)
            def answers(items):
                return [(message['params']['item']['id'], message['params']['item']['text']) for message in items
                        if message['method'] == 'item/completed' and message['params'].get('item', {}).get('type') == 'agentMessage']
            left, right = answers(events[0]), answers(events[1])
            assert left and left == right
            assert '594' in left[-1][1]
            result = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'threadId': info['threadId'],
                      'turnId': turn['turn']['id'], 'endpoint': endpoint, 'twoRpcClientsMatched': True,
                      'items': [{'itemId': item[0], 'text': item[1]} for item in left],
                      'pcTuiOutputCaptured': False, 'originalThreadVerified': False}
            (ROOT / 'docs/pc-tui-live-test.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps(result, ensure_ascii=False))
        finally:
            for reader in readers:
                reader.cancel()
            await asyncio.gather(*readers, return_exceptions=True)


if __name__ == '__main__':
    asyncio.run(verify())
