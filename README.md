# Polychat AppService

The bot written with ExpressJS in TypeScript.

## Run

```
npm install
bun run start
```

## Environment variables
* `API_BIND_ADDRESS` - Publicly available provisioning API for the linker frontend. Defaults to "0.0.0.0".
* `API_PORT` - Publicly available provisioning API for the linker frontend. Defaults to 9998.
* `APPSERVICE_BIND_ADDRESS` - The homeserver needs to be able to reach this. Defaults to "0.0.0.0".
* `APPSERVICE_PORT` - The homeserver needs to be able to reach this. Defaults to 9999.
* `DEBUG_MXID` - This Matrix User ID will get an invite to every room for debugging purposes. The appservice will ignore the user for most purposes, e.g. the !members command.
* `HOMESERVER_NAME` - The homeserver name, e.g. "matrix.org".
* `HOMESERVER_URL` - The best URL to reach the homeserver, e.g. https://matrix-client.matrix.org.
* `PATH_DATA` - Folder path to persist data. Makes starting up faster and prevents events from being processed twice.
* `PATH_CONFIG` - Folder path for config files. Needs `registration.yaml`.

* `IRC_BRIDGE_MXID` - The Matrix User ID of the IRC bridge.
* `IRC_BRIDGE_SERVER` - The IRC server name on the IRC bridge, e.g. "inspircd".
* `WHATSAPP_BRIDGE_MXID` - The Matrix User ID of the WhatsApp bridge.
* `SIGNAL_BRIDGE_MXID` - The Matrix User ID of the Signal bridge.
* `TELEGRAM_BRIDGE_MXID` - The Matrix User ID of the Telegram bridge.
* `TELEGRAM_BRIDGE_TUG_MXID` - A 2nd Matrix User ID used for opening a chat group (requires 2 users).
* `TELEGRAM_BRIDGE_COMMAND_PREFIX` - How to address the Telegram bridge bot? Defaults to "!tg".

## Documentation

### Sub Rooms

Stages:

- `unclaimed` - The room has been prepared for a specific Polychat.
- `claimed` - The room is assigned to a user who has not joined yet. We may not know the third-party identity of the user.
- `active` - The room is actively bridged for a specific user.
