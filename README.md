# Polychat AppService

The bot written with ExpressJS in TypeScript.

## Run

```sh
# Use npm to install the dependencies.
# Bun fails to install `matrix-bot-sdk` correctly.
npm install
# Use bun to run this application.
# Its written in TypeScript and there's no transpilation configured for NodeJS.
bun run start
```

## Environment variables
* `API_BIND_ADDRESS` - Publicly available provisioning API for the linker frontend. Defaults to "0.0.0.0".
* `API_PORT` - Publicly available provisioning API for the linker frontend. Defaults to 9998.
* `APPSERVICE_BIND_ADDRESS` - The homeserver needs to be able to reach this. Defaults to "0.0.0.0".
* `APPSERVICE_PORT` - The homeserver needs to be able to reach this. Defaults to 9999.
* `DEBUG_MXID` - This Matrix User ID will get an invite to every room for debugging purposes. In sub rooms, this user can impersonate the Polychat user.
* `HOMESERVER_NAME` - The homeserver name, e.g. "matrix.org".
* `HOMESERVER_URL` - The best URL to reach the homeserver, e.g. https://matrix-client.matrix.org.
* `PATH_DATA` - Folder path to persist data. Makes starting up faster and prevents events from being processed twice.
* `PATH_CONFIG` - Folder path for config files. Needs `registration.yaml`.
* `SUB_ROOMS_POOL_TARGET` - The number of sub rooms we want to have per network. Defaults to 2.

### Networks
* `IRC_BRIDGE_MXID` - The Matrix User ID of the IRC bridge.
* `IRC_BRIDGE_SERVER` - The IRC server name on the IRC bridge, e.g. "inspircd".
* `SIGNAL_BRIDGE_MXID` - The Matrix User ID of the Signal bridge.
* `SIGNAL_BRIDGE_ACCOUNT_MXIDS` - A comma-separated list of Matrix User IDs which have a linked Signal account. They will be the "Polychat" account talking to Signal users.
* `SIGNAL_BRIDGE_COMMAND_PREFIX` - How to address the Signal bridge bot? Defaults to "!signal".
* `TELEGRAM_BRIDGE_MXID` - The Matrix User ID of the Telegram bridge. Needs to be registered with the Telegram bridge.
* `TELEGRAM_BRIDGE_ACCOUNT_MXIDS` - A comma-separated list of Matrix User IDs which have a linked Telegram account. They will be the "Polychat" account talking to Telegram users.
* `TELEGRAM_BRIDGE_TUG_MXID` - A 2nd Matrix User ID used for opening a chat group (requires 2 users). Needs to be registered with the Telegram bridge.
* `TELEGRAM_BRIDGE_COMMAND_PREFIX` - How to address the Telegram bridge bot? Defaults to "!tg".
* `WHATSAPP_BRIDGE_MXID` - The Matrix User ID of the WhatsApp bridge.
* `WHATSAPP_BRIDGE_ACCOUNT_MXIDS` - A comma-separated list of Matrix User IDs which have a linked WhatsApp account. They will be the "Polychat" account talking to WhatsApp users.
* `WHATSAPP_BRIDGE_COMMAND_PREFIX` - How to address the WhatsApp bridge bot? Defaults to "!wa".

### Experimental features
* `LOAD_EXISTING_ROOMS` - Experimental!! Set to "true" to load existing rooms. Defaults to false.

## Logging

The project uses the JSON logger pino. It can be configured with a file called `$PATH_CONFIG/pino.json`.

To learn about its configuration options, see https://getpino.io/#/docs/api?id=options.

### Pretty CLI logging

```sh
# You may still need to install pino-pretty
npm install --global pino-pretty

# When you run it directly
bun run start | pino-pretty

# When you run it as a Docker container
docker logs polychat-appservice | pino-pretty
```

## Documentation

There are
* Main rooms - One per Polychat
* Sub rooms - One per Polychat and Polychat user
* Control rooms - One per Polychat user

### Sub Rooms

Stages:

1. created - The Matrix room has been created.
2. ready - The room is linked to a 3rd-party network and ready to be claimed.
3. claimed - The room is assigned to a Polychat and a user who has not joined yet. We may not know the third-party identity of the user.
4. active - The room has been joined by a user and messages are being bridged.

### State events

#### Main room

```json
{
    "type": "de.polychat.room",
    "state_key": "",
    "content": {
        "type": "main"
    }
}
```

##### Per attached sub room

```json
{
    "type": "de.polychat.room.participant",
    "state_key": "!abc:localhost",
    "content": {
        "room_id": "!abc:locahost",
        "user_id": "@abc:localhost"
    }
}
```

* Ignore the `state_key`. It's just required to be unique.
* Use `room_id` to identify the sub room.
* Ignore the `user_id`. It might used in the future.

#### Sub Room

```json
{
    "type": "de.polychat.room",
    "state_key": "",
    "content": {
        "type": "sub",
        "network": "telegram",
        "polychat_user_id": "@polychat_000001:polychat.de",
        "timestamp_created": 1708750797214,
    }
}
```

##### After it is ready to be claimed

```json
{
    "type": "de.polychat.room",
    "state_key": "",
    "content": {
        "type": "sub",
        "network": "telegram",
        "polychat_user_id": "@bridged_to_telegram_001:polychat.de",
        "timestamp_created": 1708750797214,
        "timestamp_ready": 1708750815712,
        "invite_link": "https://t.me/+O_22QPKlYkswYzAy"
    }
}
```

##### After it has been claimed

```json
{
    "type": "de.polychat.room",
    "state_key": "",
    "content": {
        "type": "sub",
        "network": "telegram",
        "polychat_user_id": "@polychat_000001:polychat.de",
        "timestamp_created": 1708750797214,
        "timestamp_ready": 1708750815712,
        "invite_link": "https://t.me/+O_22QPKlYkswYzAy",
        "timestamp_claimed": 1708751064269,
        "user": {
            "identity": "inherit",
            "localpart_in_main_room": "@polychat_000001:polychat.de",
        }
    }
}
```

##### After a user has joined

```json
{
    "type": "de.polychat.room",
    "state_key": "",
    "content": {
        "type": "sub",
        "network": "telegram",
        "polychat_user_id": "@polychat_000001:polychat.de",
        "timestamp_created": 1708750797214,
        "timestamp_ready": 1708750815712,
        "invite_link": "https://t.me/+O_22QPKlYkswYzAy",
        "timestamp_claimed": 1708751064269,
        "user": {
            "identity": "inherit",
            "localpart_in_main_room": "@polychat_000001:polychat.de",
        },
        "timestamp_joined": 1708751938226,
        "user_id": "@telegram_01010101:polychat.de"
    }
}
```

##### After a user has left

```json
{
    "type": "de.polychat.room",
    "state_key": "",
    "content": {
        "type": "sub",
        "network": "telegram",
        "polychat_user_id": "@polychat_000001:polychat.de",
        "timestamp_created": 1708750797214,
        "timestamp_ready": 1708750815712,
        "invite_link": "https://t.me/+O_22QPKlYkswYzAy",
        "timestamp_claimed": 1708751064269,
        "user": {
            "identity": "inherit",
            "localpart_in_main_room": "@polychat_000001:polychat.de",
        },
        "timestamp_joined": 1708751938226,
        "user_id": "@telegram_01010101:polychat.de",
        "timestamp_left": 1708752077566,
    }
}
```

