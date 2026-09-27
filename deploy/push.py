"""把本地 cloud-tour-3d 部署到 SCNet 主机（SFTP 上传 + 远端解包 + 安装 three + 重启服务）。

用法（密码只从环境变量读取，不写入任何文件）：
    CT3D_SSH_PASS=... python deploy/push.py --host ksai.scnet.cn --port 50396 [--with-cache]
"""
import argparse
import io
import os
import sys
import tarfile
import time

import paramiko

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REMOTE = '/root/private_data/cloud-tour-3d'
NODE_BIN = '/root/private_data/.orbit-runtime/node-v24.18.0-linux-x64/bin'
EXCLUDE_TOP = {'cache', 'node_modules', '.claude', '.run', '.git'}


def build_code_tar():
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz') as tar:
        for name in sorted(os.listdir(ROOT)):
            if name in EXCLUDE_TOP:
                continue
            tar.add(os.path.join(ROOT, name), arcname=name, filter=lambda ti: None if '__pycache__' in ti.name else ti)
    return buf.getvalue()


def build_cache_tar(path):
    with tarfile.open(path, mode='w') as tar:
        for sub in ('img', 'dem', 'osm', 'api'):
            p = os.path.join(ROOT, 'cache', sub)
            if os.path.isdir(p):
                tar.add(p, arcname=f'cache/{sub}')


def run(ssh, cmd, check=True, timeout=600):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf8', 'replace')
    err = stderr.read().decode('utf8', 'replace')
    code = stdout.channel.recv_exit_status()
    print(f'$ {cmd[:160]}\n{out}{err}'.rstrip())
    if check and code != 0:
        sys.exit(f'remote command failed ({code})')
    return out


def progress(label):
    t0 = time.time()

    def cb(done, total):
        if total and (done == total or int(done / total * 20) != getattr(cb, 'last', -1)):
            cb.last = int(done / total * 20)
            rate = done / max(0.01, time.time() - t0) / 1e6
            print(f'  {label}: {done / 1e6:.1f}/{total / 1e6:.1f} MB  {rate:.2f} MB/s', flush=True)

    return cb


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', default='ksai.scnet.cn')
    ap.add_argument('--port', type=int, required=True)
    ap.add_argument('--user', default='root')
    ap.add_argument('--with-cache', action='store_true', help='同时上传本地瓦片/建筑缓存（预热）')
    ap.add_argument('--no-restart', action='store_true')
    ap.add_argument('--pull-osm', action='store_true', help='只把远端 OSM 缓存（建筑/道路，含原始响应）拉回本地')
    a = ap.parse_args()
    pw = os.environ.get('CT3D_SSH_PASS')
    if not pw:
        sys.exit('请通过环境变量 CT3D_SSH_PASS 提供 SSH 密码')

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(a.host, port=a.port, username=a.user, password=pw, timeout=30, banner_timeout=30)
    sftp = ssh.open_sftp()
    run(ssh, f'mkdir -p {REMOTE}/.run {REMOTE}/cache')

    if a.pull_osm:
        run(ssh, f'cd {REMOTE} && tar -cf .run/osm.tar cache/osm && ls -la .run/osm.tar')
        local = os.path.join(os.environ.get('TEMP', '/tmp'), 'ct3d-osm.tar')
        sftp.get(f'{REMOTE}/.run/osm.tar', local, callback=progress('osm'))
        run(ssh, f'rm -f {REMOTE}/.run/osm.tar')
        with tarfile.open(local) as tar:
            tar.extractall(ROOT, filter='data')
        os.remove(local)
        print('pulled cache/osm into', ROOT)
        return

    code = build_code_tar()
    print(f'code tar: {len(code) / 1024:.0f} KB')
    with sftp.open(f'{REMOTE}/.run/code.tgz', 'wb') as f:
        f.set_pipelined(True)
        f.write(code)
    # 解包到暂存目录后逐个 rename 覆盖：正在运行的脚本持有旧 inode 不受影响（网络盘上 rm 打开中的文件会失败）
    run(ssh, f'cd {REMOTE} && rm -rf .run/stage && mkdir -p .run/stage && tar -xzf .run/code.tgz -C .run/stage && '
             f'(cd .run/stage && find . -type f | while IFS= read -r f; do mkdir -p "../../$(dirname "$f")" && mv -f "$f" "../../$f"; done) && '
             f'chmod +x deploy/start.sh && rm -rf .run/stage .run/code.tgz && ls')

    if a.with_cache:
        tmp = os.path.join(os.environ.get('TEMP', '/tmp'), 'ct3d-cache.tar')
        build_cache_tar(tmp)
        size = os.path.getsize(tmp)
        print(f'cache tar: {size / 1e6:.0f} MB')
        sftp.put(tmp, f'{REMOTE}/.run/cache.tar', callback=progress('cache'))
        os.remove(tmp)
        run(ssh, f'cd {REMOTE} && tar -xf .run/cache.tar && rm -f .run/cache.tar && du -sh cache/*', timeout=900)

    # three（只在缺失或版本不符时安装，经容器代理）
    need = run(ssh, f'cd {REMOTE} && node -e "try{{const v=require(\'./node_modules/three/package.json\').version;const w=require(\'./package.json\').dependencies.three;process.stdout.write(v===w?\'ok\':\'mismatch\')}}catch{{process.stdout.write(\'missing\')}}"', check=False).strip()
    if not need.endswith('ok'):
        run(ssh, f'cd {REMOTE} && export $(tr "\\0" "\\n" < /proc/1/environ | grep -iE "^https?_proxy=" | xargs) && '
                 f'PATH={NODE_BIN}:$PATH npm install --omit=dev --no-audit --no-fund 2>&1 | tail -5', timeout=900)

    if not a.no_restart:
        # 监护脚本在则只重启 Node 进程，否则拉起监护脚本
        run(ssh, f'cd {REMOTE} && if [ -f .run/server.pid ] && kill -0 $(cat .run/server.pid) 2>/dev/null; then kill -TERM $(cat .run/server.pid); echo restarted-node; '
                 f'else setsid -f bash deploy/start.sh >/dev/null 2>&1 < /dev/null; echo started-supervisor; fi')
        time.sleep(6)
        run(ssh, 'curl -s -m 10 http://127.0.0.1:8725/cloud-tour/api/health; echo; tail -5 /root/private_data/cloud-tour-3d/.run/server.log', check=False)
    sftp.close()
    ssh.close()


if __name__ == '__main__':
    main()
