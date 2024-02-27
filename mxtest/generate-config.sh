#!/bin/sh

set -eu

echo "
id: ${1}
url: ${2}
as_token: $(openssl rand -hex 64)
hs_token: $(openssl rand -hex 64)
sender_localpart: ${1}
namespaces:
  users:
    - exclusive: false
      regex: '@${1}_*'
  aliases:
    - exclusive: true
      regex: '#${1}_*'
" >> ${3}
