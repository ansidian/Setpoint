#!/usr/bin/env python3
"""Exercise the real nginx config in network-isolated disposable Docker containers.

No production files, credentials, ports, network, or Setpoint instance are used.
Requires Docker, Python 3 and openssl. Image pulls require network access.
"""
import pathlib
import subprocess
import tempfile
import uuid

NGINX = "nginx:1.30.5-alpine@sha256:ef8676b33d681f272ba429b27658bdd7e640963279714c96bddf1dc76307f7b6"
NODE = "node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df"
HERE = pathlib.Path(__file__).resolve().parent
TEST = r"""
import http from 'node:http';
import assert from 'node:assert/strict';
const upstream = http.createServer(async(req,res)=>{
  let body=''; for await(const part of req) body+=part;
  res.writeHead(202, {'Content-Type':'application/json'});
  res.end(JSON.stringify({url:req.url,method:req.method,body,headers:req.headers}));
});
await new Promise(resolve=>upstream.listen(3001,'127.0.0.1',resolve));
const call=(path,method='POST',headers={},body='')=>new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port:18765,path,method,headers},res=>{
    let text=''; res.on('data',d=>text+=d);res.on('end',()=>resolve({status:res.statusCode,text}));
  });req.on('error',reject);req.end(body);
});
try {
  for(let i=0;i<30;i++) {
    try {await call('/');break;}catch(e){if(i===29)throw e;await new Promise(r=>setTimeout(r,100));}
  }
  for(const route of ['/api/gmail/push','/api/calendar/push','/api/todoist/webhook']) {
    const body='{"message":"fictional only"}';
    const result=await call(route+'?token=fixture-only','POST',{
      'Content-Type':'application/json',Authorization:'Bearer fixture-only',
      'X-Goog-Channel-Token':'fixture-calendar','X-Todoist-Hmac-Sha256':'fixture-signature',
      'X-Forwarded-For':'203.0.113.1','X-Forwarded-Proto':'http'
    },body);
    assert.equal(result.status,202);
    const echoed=JSON.parse(result.text);
    assert.equal(echoed.url,route+'?token=fixture-only');assert.equal(echoed.body,body);
    assert.equal(echoed.headers.authorization,'Bearer fixture-only');
    assert.equal(echoed.headers['x-goog-channel-token'],'fixture-calendar');
    assert.equal(echoed.headers['x-todoist-hmac-sha256'],'fixture-signature');
    assert.equal(echoed.headers['x-forwarded-for'],'127.0.0.1');
    assert.equal(echoed.headers['x-forwarded-proto'],'https');
    for(const method of ['GET','HEAD','PUT','OPTIONS','DELETE']) assert.equal((await call(route,method)).status,404);
  }
  for(const route of ['/', '/healthz', '/api/ea/accounts/gmail/callback', '/api/login', '/assets/main.js',
    '/api/gmail/push/', '//api/gmail/push', '/api/../api/gmail/push', '/api/gmail/%70ush']) {
    assert.equal((await call(route)).status,404,route);
  }
  assert.equal((await call('/api/gmail/push','POST',{},'x'.repeat(1024*1024+1))).status,413);
  console.log('PASS: exact paths/methods, body/query/auth preservation, proxy-header overwrite, body limit');
} finally {await new Promise(resolve=>upstream.close(resolve));}
"""

def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def main():
    name = 'setpoint-ingress-test-' + uuid.uuid4().hex[:12]
    with tempfile.TemporaryDirectory(prefix='setpoint-ingress-') as directory:
        root = pathlib.Path(directory)
        certs = root / 'live' / 'setpoint.example.com'
        certs.mkdir(parents=True)
        run('openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
            '-subj', '/CN=setpoint.example.com', '-keyout', str(certs / 'privkey.pem'),
            '-out', str(certs / 'fullchain.pem'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # Only substitute the private listener address inside the isolated namespace.
        config = root / 'nginx.conf'
        config.write_text((HERE / 'nginx.conf').read_text().replace('100.64.0.10:443', '127.0.0.1:443'))
        try:
            run('docker', 'run', '--detach', '--name', name, '--network', 'none',
                '--mount', f'type=bind,source={root},target=/etc/letsencrypt,readonly',
                '--mount', f'type=bind,source={config},target=/etc/nginx/nginx.conf,readonly',
                '--entrypoint', 'nginx', NGINX, '-g', 'daemon off;')
            run('docker', 'exec', name, 'nginx', '-t')
            run('docker', 'run', '--rm', '--network', f'container:{name}', NODE,
                'node', '--input-type=module', '-e', TEST)
            logs = subprocess.check_output(['docker', 'logs', name], stderr=subprocess.STDOUT).decode()
            assert 'fixture-only' not in logs and 'fixture-calendar' not in logs
            print('PASS: nginx logs omit request/query/header secrets')
        finally:
            subprocess.run(['docker', 'rm', '--force', name], check=False, stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
