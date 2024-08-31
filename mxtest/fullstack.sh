#!/bin/sh

set -eu

# attempt to kill previous instance
docker compose down --remove-orphans

# first install mxtest into ./mxtest if not present
if [ ! -d mxtest ]; then
  # extract from docker image
  image=registry.gitlab.com/mb-saces/mxtest:next
  docker pull $image
  container_id=$(docker create "$image")
  docker cp "$container_id:/mxtest" mxtest
  docker rm "$container_id"
fi

# install it by adding it to path
export PATH=$(pwd)/mxtest/bin:${PATH}


# remove leftovers from previous run
mxtest purge


# create default .env
mxtest init

# include configuration
. ./.env


# configure services you want to use
${MXTEST_SDK_ROOT}/hs/synapse/setup.sh


# Adjust configuration to your needs, defaults are fine for local testing.


# start and wait for synapse to be healthy
mxcompose up -d --wait synapse


# do something with service
mxcompose exec synapse register_new_matrix_user -c /data/homeserver.yaml -u testadmin -p testadmin -a
mxcompose exec synapse register_new_matrix_user -c /data/homeserver.yaml -u testuser -p testuser --no-admin



# create directories for pcas
mkdir -p data/pcas/config
mkdir -p data/pcas/data

# generate configuration/registration for pcas
./generate-config.sh mxtest "http://pcas-dev:9999" data/pcas/config/registration.yaml

# register appservice
${MXTEST_SDK_ROOT}/hs/synapse/addbridge.sh data/pcas/config/registration.yaml pcas-registration.yaml

# restart (and only) synapse 
mxcompose restart --no-deps synapse

# start appservice, devel version

mxcompose up -d pcas-dev
