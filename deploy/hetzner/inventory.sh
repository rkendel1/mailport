#!/bin/sh
set -eu

output=${1:-inventory.txt}
umask 077
{
  echo "## hostname"; hostname
  echo "## uname"; uname -a
  echo "## disk"; df -h
  echo "## memory"; free -h
  echo "## listeners"; ss -lntup
  echo "## containers"; docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'
  echo "## docker disk"; docker system df
  echo "## services"; systemctl --type=service --state=running --no-pager
  echo "## addresses"; ip addr
  echo "## routes"; ip route
  echo "## protected workload"; stat /opt/grabit 2>&1 || true
  echo "## protected workload disk"; du -h --max-depth=2 /opt/grabit 2>&1 || true
  echo "## protected workload layout"; find /opt/grabit -xdev -maxdepth 2 -printf '%y %m %u %g %s %T@ %p\n' 2>&1 | sort || true
} > "$output"
chmod 600 "$output"
echo "$output"
