// require('./instrumentation.ts');

import {
    Appservice,
    IAppserviceRegistration,
    SimpleFsStorageProvider,
    SimpleRetryJoinStrategy,
    AutojoinRoomsMixin,
} from "matrix-bot-sdk";

import * as path from 'node:path';
import { uniqueId } from "./helper";

const PATH_DATA = process.env.PATH_DATA || './data';
const PATH_CONFIG = process.env.PATH_CONFIG || './config';
const HOMESERVER_NAME = process.env.HOMESERVER_NAME || 'localhost';
const HOMESERVER_URL = process.env.HOMESERVER_URL || 'http://localhost:8008';
const DEBUG_MXID = process.env.DEBUG_MXID;

const registration: IAppserviceRegistration = {
    as_token: 'ha',
    hs_token: 'ha',
    namespaces: {
        users: [
            {
                exclusive: false,
                regex: '@polychat_.*'
            }
        ],
        rooms: [],
        aliases: [],
    },
    sender_localpart: 'polychat',
};
const appservice = new Appservice({
    port: 9999,
    bindAddress: '0.0.0.0',
    homeserverName: HOMESERVER_NAME,
    homeserverUrl: HOMESERVER_URL,
    registration,
    storage: new SimpleFsStorageProvider(path.join(PATH_DATA, 'appservice.json')), // or any other IAppserviceStorageProvider
    joinStrategy: new SimpleRetryJoinStrategy(), // just to ensure reliable joins
});


type SubRoomUser = {
    localpart: string,
    handOut: Date,
} & ({
    identity: 'inherit',
} | {
    identity: 'custom',
    displayName: string,
    avatar: string,
});

type SubRoom = {
    ready?: Date,
    roomId: string,
    user?: SubRoomUser,
    url?: string,
}

type Channel = {
    name: string,
    avatar?: string,
    mainRoomId: string,
    unclaimedSubRooms: SubRoom[],
    claimedSubRooms: SubRoom[],
    activeSubRooms: SubRoom[],
};

const channels: Map<string, Channel> = new Map();

// subroom
// whatsapp_
// Channel_

async function handOutSubRoom(channelId: string, network: string): Promise<string> {
    const channel = channels.get(channelId);
    if (!channel) {
        throw Error('E_CHANNEL_NOT_FOUND');
    }
    const subRoom = channel.unclaimedSubRooms.shift();
    if (!subRoom) {
        throw Error('E_OUT_OF_SUB_ROOMS');
    }
    subRoom.user = {
        localpart: uniqueId('polychat_'),
        identity: 'inherit',
        handOut: new Date(),
    };
    channel.claimedSubRooms.push(subRoom);
    return subRoom.url!;
}

function findSubRoom(roomId: string): { channel: Channel, subRoom: SubRoom } | undefined {
    for (const channel of channels.values()) {
        const subRoom = [...channel.activeSubRooms].find(r => r.roomId === roomId);
        if (subRoom) {
            return {
                channel,
                subRoom,
            };
        }
    }
}

function findMainRoom(roomId: string): Channel | undefined {
    for (const channel of channels.values()) {
        if (channel.mainRoomId === roomId) {
            return channel;
        }
    }
}

const onMessageInSubRoom = async (subRoom: SubRoom, channel: Channel, event: any) => {
    const polychatIntent = appservice.getIntent('polychat');
    if (event.sender === `@polychat:${HOMESERVER_NAME}`) {
        // Ignore echo
        return;
    }

    const handOutRegExp = /^hand out ([a-z]+?) ([a-z]+?)$/;
    const match = event.content.body.match(handOutRegExp);
    if (match) {
        const polychatIntent = appservice.getIntent('polychat');
        try {
            const url = await handOutSubRoom(match[1], match[2]);
            await polychatIntent.sendText(subRoom.roomId, `here you go ${url}`);
        } catch (error: any) {
            await polychatIntent.sendText(subRoom.roomId, `error ${error.message}`);
        }
        return;
    }

    // commands
    if (event.content.body === '!members') {
        await polychatIntent.sendText(subRoom.roomId, `Members:\n* Anna\n* Bernd`);
        return;
    }

    const user = subRoom.user;
    if (!user) {
        await polychatIntent.sendText(subRoom.roomId, 'Internal Error: No user identity set. Did you skip a step?');
        return;
    }

    const intent = appservice.getIntent(user.localpart);
    await intent.sendEvent(channel.mainRoomId, event.content);
};

const onMessageInMainRoom = async (channel: Channel, event: any) => {
    const intent = appservice.getIntent('polychat');
    for (const subRoom of channel.activeSubRooms) {
        if (subRoom.user && event.sender === `@${subRoom.user.localpart}:${HOMESERVER_NAME}`) {
            // Don't send echo
            continue;
        }
        intent.sendEvent(subRoom.roomId, event.content);
    }
};

// Attach listeners here
appservice.on("room.message", async (roomId: string, event: any) => {
    if (!event['content']?.['msgtype']) return;

    const subRoomInfo = findSubRoom(roomId);
    if (subRoomInfo) {
        return onMessageInSubRoom(subRoomInfo.subRoom, subRoomInfo.channel, event);
    }

    const channel = findMainRoom(roomId);
    if (channel) {
        return onMessageInMainRoom(channel, event);
    }

    console.info(`Didn't know what to do with event in ${roomId}`);
});

appservice.on("room.event", async (roomId: string, event: any) => {
    if (event['type'] !== 'm.room.avatar' || event['state_key'] !== '') return;

    const channel = findMainRoom(roomId);
    if (channel) {
        console.info(`AVATAR CHANGED ${JSON.stringify(event.content)}`);
        const intent = appservice.getIntent('polychat');
        for (const subRoom of channel.activeSubRooms) {
            await intent.underlyingClient.sendStateEvent(subRoom.roomId, 'm.room.avatar', '', event.content);
        }
    }
});

// Typically appservices will want to autojoin all rooms
AutojoinRoomsMixin.setupOnAppservice(appservice);

const intent = appservice.getIntent('polychat');
await intent.ensureRegistered();

async function createRooms() {
    const intent = appservice.getIntent('polychat');
    const mainRoomId = await intent.underlyingClient.createRoom({
        name: 'Yoga',
        room_alias_name: 'irc_#football-usera',
        ...(DEBUG_MXID && {
            invite: [DEBUG_MXID],
        }),
    });

    const channel: Channel = {
        name: 'Yoga',
        mainRoomId,
        unclaimedSubRooms: [],
        claimedSubRooms: [],
        activeSubRooms: [],
    };

    channels.set('yoga', channel);

    for (let i = 0; i < 4; i++) {
        const roomId = await intent.underlyingClient.createRoom({
            name: 'Yoga',
            ...(DEBUG_MXID && {
                invite: [DEBUG_MXID],
            }),
        });
        channel.unclaimedSubRooms.push({
            ready: new Date(),
            roomId,
        });
    }
}

async function hardcodedFootballCreationForChristian() {
    const intent = appservice.getIntent('polychat');
    await intent.ensureRegistered();

    await intent.underlyingClient.createRoom({
        name: 'Football - User A',
        room_alias_name: 'irc_#football-usera',
        ...(DEBUG_MXID && {
            invite: [DEBUG_MXID],
        }),
    });

    await intent.underlyingClient.createRoom({
        name: 'Football - User B',
        room_alias_name: 'irc_#football-userb',
        ...(DEBUG_MXID && {
            invite: [DEBUG_MXID],
        }),
    });
}

async function hardcodedForRetreat() {
    const intent = appservice.getIntent('polychat');
    await intent.ensureRegistered();

    const mainRoomId = await intent.underlyingClient.createRoom({
        name: `Football ${new Date().toISOString()}`,
    });
    if (DEBUG_MXID) {
        await intent.underlyingClient.inviteUser(DEBUG_MXID, mainRoomId);
        await intent.underlyingClient.setUserPowerLevel(DEBUG_MXID, mainRoomId, 50);
    }

    const channel: Channel = {
        name: 'Football',
        mainRoomId,
        unclaimedSubRooms: [],
        claimedSubRooms: [],
        activeSubRooms: [],
    };

    channels.set('football', channel);
    for (const username of ['usera', 'userb']) {
        const roomId = await intent.ensureJoined(`#irc_#football-${username}:${HOMESERVER_NAME}`);
        if (DEBUG_MXID) {
            await intent.underlyingClient.inviteUser(DEBUG_MXID, roomId);
            await intent.underlyingClient.setUserPowerLevel(DEBUG_MXID, roomId, 50);
        }
        channel.activeSubRooms.push({
            ready: new Date(),
            roomId,
            user: {
                localpart: uniqueId('polychat_'),
                handOut: new Date(),
                identity: 'inherit',
            },
        });
    }
}

appservice.begin().then(() => {
    console.log('running');
}).then(hardcodedForRetreat);

// console.log(as.eventNames());
