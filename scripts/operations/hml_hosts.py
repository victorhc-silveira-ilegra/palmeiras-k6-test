"""Inspeção de leitura via SSM, limitada aos membros descobertos de HML."""

import datetime as dt
import json
import time

from hml_context import sanitize

REMOTE = r"""
import datetime as dt,json,pathlib,re,subprocess,os
start=dt.datetime.fromisoformat(START)
end=dt.datetime.fromisoformat(END)
def command(args):
 p=subprocess.run(args,capture_output=True,text=True,timeout=10)
 return p.stdout.strip()
config=command(['nginx','-T'])
config=re.sub(r'(?m)^\s*#.*$','',config)
sockets=sorted(set(re.findall(r'fastcgi_pass\s+([^;]+);',config)))
units=command(['systemctl','list-units','--type=service','--state=running','--no-legend'])
php=[line.split()[0] for line in units.splitlines() if re.search(r'php.*fpm',line)]
services={}
bindings=command(['ss','-xlpn'])+'\n'+command(['ss','-ltnp'])
for unit in php:
 text=command(['systemctl','show',unit,'-p','ExecStart','-p','ActiveState','-p','MainPID'])
 pid=re.search(r'MainPID=(\d+)',text)
 owner='pid='+pid[1]+',' if pid else ''
 serves=bool(owner) and any(
  owner in line and any((sock[5:] if sock.startswith('unix:') else sock) in line for sock in sockets)
  for line in bindings.splitlines())
 services[unit]={'active':'ActiveState=active' in text,'serves_upstream':serves,
                 'binary':re.findall(r'path=([^ ;]+)',text)}
logs=[]
for name in ['/var/log/nginx/error.log','/var/www/html/wordpress/wp-content/debug.log']:
 p=pathlib.Path(name)
 if not p.exists():
  logs.append({'file':name,'status':'unavailable'})
  continue
 with p.open('rb') as f:
  f.seek(max(0,p.stat().st_size-65536))
  lines=f.read().decode(errors='replace').splitlines()
 matched=[]
 for line in lines:
  stamp=re.match(r'(\d{4}/\d\d/\d\d \d\d:\d\d:\d\d)',line)
  if stamp:
   date=dt.datetime.strptime(stamp[1],'%Y/%m/%d %H:%M:%S').astimezone()
  else:
   stamp=re.match(r'\[(\d{2}-[A-Za-z]{3}-\d{4} \d\d:\d\d:\d\d) (UTC|[+-]\d{4})\]',line)
   if not stamp:
    continue
   zone='+0000' if stamp[2]=='UTC' else stamp[2]
   date=dt.datetime.strptime(stamp[1]+' '+zone,'%d-%b-%Y %H:%M:%S %z')
  if start <= date <= end:
   kind='other'
   for pattern,label in [('upstream timed out','upstream_timeout'),('PHP Fatal','php_fatal'),('deadlock','deadlock')]:
    if pattern.lower() in line.lower():
     kind=label
     break
   matched.append({'timestamp':date.isoformat(),'category':kind})
 logs.append({'file':name,'status':'ok' if matched else 'no_data',
              'events':matched,'coverage':'last_64KiB_timestamped_lines'})
print(json.dumps({'load':os.getloadavg(),'php_services':services,'upstream_sockets':sockets,
 'mount':command(['findmnt','-T','/var/www/html/wordpress','-o','TARGET,SOURCE,FSTYPE']),
 'logs':logs}))
"""


def inspect_host(client, topology: dict, host_id: str, start: dt.datetime, end: dt.datetime) -> dict:
    members = {host["InstanceId"] for host in topology["instances"]}
    if host_id not in members:
        raise ValueError("Instância fora da descoberta atual de HML.")
    script = "START=" + repr(start.isoformat()) + "\nEND=" + repr(end.isoformat()) + REMOTE
    try:
        command = client.call(
            "ssm", "send-command", instance_ids=[host_id],
            document_name="AWS-RunShellScript",
            parameters={"commands": ["python3 - <<'HML_INSPECT'\n" + script + "\nHML_INSPECT"]},
            timeout_seconds=30,
        )["Command"]["CommandId"]
        deadline = time.monotonic() + 35
        while time.monotonic() < deadline:
            try:
                result = client.call(
                    "ssm", "get-command-invocation", command_id=command, instance_id=host_id,
                )
            except RuntimeError as exc:
                if "InvocationDoesNotExist" not in str(exc):
                    raise
                time.sleep(1)
                continue
            if result["Status"] == "Success":
                return {"status": "ok", "data": json.loads(result["StandardOutputContent"])}
            if result["Status"] in ("Failed", "TimedOut", "Cancelled"):
                return {"status": "error", "error": sanitize(result.get("StandardErrorContent", result["Status"]))}
            time.sleep(1)
        return {"status": "unavailable", "note": "Comando SSM ainda sem resultado; consulta encerrada."}
    except Exception as exc:
        return {"status": "error", "error": sanitize(str(exc))}
