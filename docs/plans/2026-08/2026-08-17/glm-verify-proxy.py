#!/usr/bin/env python3
"""GLM-5.3 思考档位验收代理：打印请求中的思考参数，透传到智谱端点。

用法：
  python glm-verify-proxy.py
  然后把 Proma 渠道 baseUrl 临时改为 http://127.0.0.1:8899/api/anthropic
  （anthropic 协议渠道，如 Plan 版 zhipu-coding；验收完改回 https://open.bigmodel.cn）
"""
import json
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TARGET = 'https://open.bigmodel.cn'
PORT = 8899


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        try:
            payload = json.loads(body)
            model = payload.get('model')
            thinking = payload.get('thinking')
            reasoning = payload.get('reasoning')
            reasoning_effort = payload.get('reasoning_effort')
            print(f'>> POST {self.path} model={model}')
            if thinking is not None:
                print(f'   thinking          = {json.dumps(thinking, ensure_ascii=False)}')
            if reasoning is not None:
                print(f'   reasoning         = {json.dumps(reasoning, ensure_ascii=False)}')
            if reasoning_effort is not None:
                print(f'   reasoning_effort  = {reasoning_effort}')
            if thinking is None and reasoning is None and reasoning_effort is None:
                print('   （无思考相关字段）')
        except Exception:
            print(f'>> POST {self.path} (non-json body {length}B)')

        req = urllib.request.Request(
            TARGET + self.path, data=body, method='POST',
            headers={k: v for k, v in self.headers.items()
                     if k.lower() not in ('host', 'content-length', 'accept-encoding')})
        try:
            resp = urllib.request.urlopen(req, timeout=300)
        except urllib.error.HTTPError as e:
            resp = e
        self.send_response(resp.code)
        for k, v in resp.headers.items():
            if k.lower() not in ('transfer-encoding', 'content-length', 'connection'):
                self.send_header(k, v)
        self.end_headers()
        while True:
            chunk = resp.read(4096)
            if not chunk:
                break
            self.wfile.write(chunk)
            self.wfile.flush()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    print(f'验收代理已启动: http://127.0.0.1:{PORT}  →  {TARGET}')
    print('等待请求...（Ctrl+C 退出）')
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
