"""공유 서버에서 이미 실행 중인 세션의 공개 이벤트만 전달합니다."""
import asyncio
import json
from pathlib import Path
import time

from websockets.asyncio.client import connect
from websockets.exceptions import WebSocketException

ROOT = Path(__file__).resolve().parents[1]


def status_label(status):
    """완료·오류·중단과 승인 대기를 분리합니다."""
    if isinstance(status, str):
        return {'completed': '응답 완료', 'failed': '오류', 'interrupted': '중단됨', 'inProgress': '처리 중'}.get(status, '상태 미확인')
    flags = status.get('activeFlags', [])
    if 'waitingOnApproval' in flags:
        return '승인 필요'
    if 'waitingOnUserInput' in flags:
        return '사용자 답변 필요'
    return {'idle': '대기', 'active': '처리 중', 'systemError': '오류', 'notLoaded': '연결 해제'}.get(status.get('type'), '상태 미확인')


class LiveState:
    """이력 본문을 사용하지 않으며 재연결하면 새 이벤트로 다시 증명합니다."""
    def __init__(self, expected_thread):
        self.expected_thread = expected_thread
        self.rows = {}
        self.connected = False
        self.pc_event_proof = None
        self.original_event_seen = False

    def loaded(self, ids):
        self.connected = True
        self.rows = {key: self.rows.get(key, {'id': key, 'name': key[:8], 'status': '상태 미확인',
                                             'turnId': None, 'itemId': None, 'reply': None}) for key in ids}

    def metadata(self, thread):
        row = self.rows.get(thread.get('id'))
        if row is not None:
            row['name'] = thread.get('name') or row['name']
            row['status'] = status_label(thread.get('status') or {})
        # thread.turns는 저장된 이력일 수 있으므로 본문·연결 증거로 사용하지 않습니다.

    def event(self, message):
        params = message.get('params') or {}
        thread_id = params.get('threadId')
        row = self.rows.get(thread_id)
        if row is None:
            return
        method = message.get('method')
        if method == 'thread/status/changed':
            row['status'] = status_label(params.get('status') or {})
        elif method == 'turn/started':
            row.update(status='처리 중', turnId=params['turn']['id'], itemId=None, reply=None)
        elif method == 'turn/completed':
            row.update(status=status_label(params['turn']['status']), turnId=params['turn']['id'])
        elif method == 'item/started' and params.get('item', {}).get('type') in ('commandExecution', 'mcpToolCall', 'dynamicToolCall'):
            row['status'] = '도구 실행 중'
        elif method == 'item/agentMessage/delta':
            same_item = row['itemId'] == params['itemId'] and row['turnId'] == params['turnId']
            row.update(turnId=params['turnId'], itemId=params['itemId'],
                       reply=((row['reply'] or '') if same_item else '') + params['delta'])
            row['reply'] = row['reply'][-6000:]
            if thread_id == self.expected_thread:
                self.original_event_seen = True
        elif method == 'item/completed' and params.get('item', {}).get('type') == 'agentMessage':
            item = params['item']
            row.update(turnId=params['turnId'], itemId=item['id'], reply=item.get('text', '')[-6000:])
            if thread_id == self.expected_thread:
                self.original_event_seen = True
        # reasoning, 도구 인자·출력, 파일 본문 등은 노출하지 않습니다.

    def disconnected(self):
        self.connected = False
        self.original_event_seen = False
        self.pc_event_proof = None

    def snapshot(self):
        row = self.rows.get(self.expected_thread, {})
        event_ids = (row.get('turnId'), row.get('itemId'))
        proven = bool(self.connected and self.original_event_seen and all(event_ids) and
                      self.pc_event_proof == event_ids)
        return {'connected': self.connected, 'sameServerSameThreadProven': proven,
                'scope': 'shared_server_loaded_threads', 'expectedThreadId': self.expected_thread,
                'originalEventSeen': self.original_event_seen,
                'sessions': [dict(row) for row in self.rows.values()] if self.connected else None}


class RpcConnection:
    """수신 루프가 응답과 알림을 분리하여 이벤트를 놓치지 않습니다."""
    def __init__(self, socket, on_event):
        self.socket, self.on_event = socket, on_event
        self.pending = {}
        self.number = 0

    async def receive(self):
        try:
            async for raw in self.socket:
                message = json.loads(raw)
                if 'method' in message:
                    if 'id' not in message:
                        self.on_event(message)
                    # 승인 요청에는 응답하지 않습니다. PC의 원래 클라이언트가 처리합니다.
                else:
                    future = self.pending.pop(message.get('id'), None)
                    if future is not None and not future.done():
                        future.set_result(message)
        finally:
            for future in self.pending.values():
                if not future.done():
                    future.set_exception(ConnectionError('공유 서버 연결이 끊겼습니다.'))
            self.pending.clear()

    async def request(self, method, params=None):
        self.number += 1
        future = asyncio.get_running_loop().create_future()
        self.pending[self.number] = future
        await self.socket.send(json.dumps({'id': self.number, 'method': method, 'params': params or {}}))
        response = await asyncio.wait_for(future, timeout=20)
        if 'error' in response:
            error = RuntimeError('공유 서버 요청이 실패했습니다.')
            error.rpc_code = response['error'].get('code')
            error.rpc_message = response['error'].get('message')
            raise error
        return response['result']

    async def initialize(self, name):
        await self.request('initialize', {'clientInfo': {'name': name, 'version': '0.1.0'},
                                          'capabilities': {'experimentalApi': True}})
        await self.socket.send(json.dumps({'method': 'initialized'}))


class LiveMonitor:
    """서버에 이미 loaded인 thread만 구독하며 새 대화와 모델 턴을 만들지 않습니다."""
    def __init__(self, expected_thread):
        self.state = LiveState(expected_thread)
        self.connection = None

    async def run(self):
        while True:
            receiver = None
            try:
                config = json.loads((ROOT / '.runtime/shared-server.json').read_text(encoding='utf-8'))
                if not config.get('active') or config.get('endpoint') != 'ws://127.0.0.1:4500':
                    raise RuntimeError('공유 서버가 준비되지 않았습니다.')
                token = (ROOT / '.runtime/shared-token.txt').read_text(encoding='utf-8').strip()
                async with connect(config['endpoint'], additional_headers={'Authorization': 'Bearer ' + token}, proxy=None) as socket:
                    rpc = RpcConnection(socket, self.state.event)
                    receiver = asyncio.create_task(rpc.receive())
                    self.connection = rpc
                    await rpc.initialize('r1_live_monitor')
                    subscribed = set()
                    while True:
                        ids, cursor = [], None
                        while True:
                            page = await rpc.request('thread/loaded/list', {'limit': 100, 'cursor': cursor})
                            ids.extend(page['data'])
                            cursor = page.get('nextCursor')
                            if not cursor:
                                break
                        self.state.loaded(ids)
                        subscribed.intersection_update(ids)
                        for thread_id in ids:
                            if thread_id not in subscribed:
                                try:
                                    result = await rpc.request('thread/resume', {'threadId': thread_id, 'excludeTurns': True})
                                except RuntimeError as error:
                                    if (getattr(error, 'rpc_message', None) or '').startswith('no rollout found'):
                                        self.state.rows[thread_id]['status'] = '첫 작업 대기'
                                        continue
                                    raise
                                self.state.metadata(result['thread'])
                                subscribed.add(thread_id)
                        proof_file = ROOT / '.runtime/original-live-proof.json'
                        self.state.pc_event_proof = None
                        if proof_file.exists():
                            proof = json.loads(proof_file.read_text(encoding='utf-8'))
                            if (proof.get('threadId') == self.state.expected_thread and
                                    proof.get('endpoint') == config['endpoint'] and
                                    proof.get('serverSessionId') == config['sessionId'] and
                                    proof.get('pcAndBridgeEventMatched') is True):
                                # 과거 수신 확인을 다른 서버 실행이나 새 응답의 증거로 재사용하지 않습니다.
                                self.state.pc_event_proof = (proof.get('turnId'), proof.get('itemId'))
                        await asyncio.sleep(2)
            except asyncio.CancelledError:
                raise
            except (OSError, RuntimeError, ValueError, TimeoutError, ConnectionError, WebSocketException):
                self.state.disconnected()
                await asyncio.sleep(3)
            finally:
                self.connection = None
                self.state.disconnected()
                if receiver:
                    receiver.cancel()
                    try:
                        await receiver
                    except (asyncio.CancelledError, WebSocketException, OSError):
                        pass

    def snapshot(self):
        result = self.state.snapshot()
        result['updatedAt'] = time.time()
        return result
