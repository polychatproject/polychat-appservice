# Polychat AppService

The bot written with ExpressJS in TypeScript.

## Run

```
npm install
bun run start
```

## Documentation

### Sub Rooms

Stages:

- `unclaimed` - The room has been prepared for a specific Polychat.
- `claimed` - The room is assigned to a user who has not joined yet. We may not know the third-party identity of the user.
- `active` - The room is actively bridged for a specific user.
