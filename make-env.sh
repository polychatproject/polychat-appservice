#!/bin/sh

set -ue

if [ ! -f './.env' ]; then
echo "MXTEST_HOME=$(pwd)
MXTEST_UID=$(id -u)
MXTEST_GID=$(id -g)
" > .env
exit 0
fi

. ./.env

if [ -z ${MXTEST_HOME:-} ]; then
echo "MXTEST_HOME=$(pwd)" >> .env
fi

if [ -z ${MXTEST_UID:-} ]; then
echo "MXTEST_UID=$(id -u)" >> .env
fi

if [ -z ${MXTEST_GID:-} ]; then
echo "MXTEST_GID=$(id -g)" >> .env
fi
