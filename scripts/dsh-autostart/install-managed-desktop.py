"""安装桌面中枢重启适配器；仅配置与备份，不退出桌面应用。"""

from datetime import datetime
from pathlib import Path
import os
import plistlib
import shutil
import subprocess
import re


def install():
    home = Path.home()
    source = Path(__file__).resolve().parent
    state = home / '.dsh-autostart'
    target = state / 'managed'
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    backup = state / 'backup' / ('managed-' + stamp)
    patch = home / '.dsh/profiles/desktop/cordis.patch.yml'
    agents = home / 'Library/LaunchAgents'
    agents.mkdir(parents=True, exist_ok=True)
    existing = list(agents.glob('*.dsh.mac-desktop.plist'))
    label = os.environ.get('DSH_DESKTOP_AGENT_LABEL', 'io.aiwuk.dsh.mac-desktop')
    if 'DSH_DESKTOP_AGENT_LABEL' not in os.environ and len(existing) == 1:
        label = plistlib.loads(existing[0].read_bytes())['Label']
    if not isinstance(label, str) or not re.fullmatch(r'[A-Za-z0-9._-]+', label):
        raise RuntimeError('登录项标识无效')
    plist = agents / (label + '.plist')
    backup.mkdir(parents=True, mode=0o700)
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    for path in (patch, plist):
        if path.exists():
            shutil.copy2(path, backup / path.name)
    for filename in ('desktop-supervisor.mjs', 'desktop-connector.mjs', 'desktop-terminate'):
        dest = target / filename
        if dest.exists():
            shutil.copy2(dest, backup / filename)
    for filename in ('desktop-supervisor.mjs', 'desktop-connector.mjs'):
        shutil.copy2(source / filename, target / filename)
        os.chmod(target / filename, 0o600)
    subprocess.run(['xcrun', 'swiftc', str(source / 'desktop-terminate.swift'),
                    '-o', str(target / 'desktop-terminate')], check=True)
    os.chmod(target / 'desktop-terminate', 0o700)
    text = patch.read_text()
    # 名称是覆盖条目的匹配条件，不能直接改名；关闭原条目并显式插入适配器。
    if 'id: mothership-desktop-connector' not in text:
        match = re.search(r'^- id: mothership-connector\n.*?(?=^- |\Z)', text, re.M | re.S)
        if match is None:
            raise RuntimeError('找不到原连接器配置，保留原配置并停止')
        block = match.group()
        if not re.search(r'^  disabled:', block, re.M):
            block = block.replace('  config:', '  disabled: false\n  config:', 1)
        original = re.sub(r'^  name:.*$', '  name: "@aiwuk/connector-bundle"', block, flags=re.M)
        original = re.sub(r'^  disabled:.*$', '  disabled: true', original, flags=re.M)
        adapter = block.replace('- id: mothership-connector', '- id: mothership-desktop-connector', 1)
        adapter = re.sub(r'^  name:.*$', '  name: "' + str(target / 'desktop-connector.mjs') + '"', adapter, flags=re.M)
        adapter = re.sub(r'^  disabled:.*$', '  disabled: false', adapter, flags=re.M)
        if re.search(r'^    allowRestart:', adapter, re.M):
            adapter = re.sub(r'^    allowRestart:.*$', '    allowRestart: true', adapter, flags=re.M)
        else:
            adapter = adapter.replace('  config:', '  config:\n    allowRestart: true', 1)
        inserted = '- insert:\n' + ''.join('    ' + line + '\n' for line in adapter.rstrip().splitlines())
        patch.write_text(text[:match.start()] + original + inserted + text[match.end():])
    logs = home / 'Library/Logs/dsh-mac-desktop'
    logs.mkdir(parents=True, exist_ok=True, mode=0o700)
    node = Path(shutil.which('node')).resolve()
    config = {
        'Label': label,
        'ProgramArguments': [str(node), str(target / 'desktop-supervisor.mjs')],
        'RunAtLoad': True, 'KeepAlive': False,
        'LimitLoadToSessionType': 'Aqua',
        'StandardOutPath': str(logs / 'launchd.out.log'),
        'StandardErrorPath': str(logs / 'launchd.err.log'),
        'EnvironmentVariables': {'PATH': str(node.parent) + ':/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'},
    }
    plist.write_bytes(plistlib.dumps(config))
    os.chmod(plist, 0o644)
    print('适配器与监督器已安装：' + str(target))
    print('原配置备份：' + str(backup))
    print('需正常退出当前桌面端后重新载入此 LaunchAgent：' + str(plist))


if __name__ == '__main__':
    install()
