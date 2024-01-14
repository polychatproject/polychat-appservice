// require('./instrumentation.ts');

import {
    Appservice,
    IAppserviceRegistration,
    SimpleFsStorageProvider,
    SimpleRetryJoinStrategy,
    AutojoinRoomsMixin,
} from "matrix-bot-sdk";

import * as path from 'node:path';

const PATH_DATA = process.env.PATH_DATA || './data';
const PATH_CONFIG = process.env.PATH_CONFIG || './config';
const HOMESERVER_NAME = process.env.HOMESERVER_NAME || 'localhost';
const HOMESERVER_URL = process.env.HOMESERVER_URL || 'http://localhost:8008';

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
    const intent = appservice.getIntent('polychat');
    if (event.sender === `@polychat:${HOMESERVER_NAME}`) {
        // Ignore echo
        return;
    }

    const handOutRegExp = /^hand out ([a-z]+?) ([a-z]+?)$/;
    const match = event.content.body.match(handOutRegExp);
    if (match) {
        const intent = appservice.getIntent('polychat');
        try {
            const url = await handOutSubRoom(match[1], match[2]);
            await intent.sendText(subRoom.roomId, `here you go ${url}`);
        } catch (error: any) {
            await intent.sendText(subRoom.roomId, `error ${error.message}`);
        }
        return;
    }

    // commands
    if (event.content.body === '!members') {
        await intent.sendText(subRoom.roomId, `Members:\n* Anna\n* Bernd`);
        return;
    }

    intent.sendEvent(channel.mainRoomId, event.content);
};

const onMessageInMainRoom = async (channel: Channel, event: any) => {
    const intent = appservice.getIntent('polychat');
    for (const subRoom of channel.activeSubRooms) {
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

// Typically appservices will want to autojoin all rooms
AutojoinRoomsMixin.setupOnAppservice(appservice);

const intent = appservice.getIntent('polychat');
await intent.ensureRegistered();

async function createRooms() {
    const intent = appservice.getIntent('polychat');
    const mainRoomId = await intent.underlyingClient.createRoom();

    const channel: Channel = {
        name: 'Yoga',
        mainRoomId,
        unclaimedSubRooms: [],
        claimedSubRooms: [],
        activeSubRooms: [],
    };

    channels.set('a', channel);

    for (let i = 0; i < 4; i++) {
        const roomId = await intent.underlyingClient.createRoom();
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
        room_alias_name: 'irc_inspircd_football-usera',
        invite: [`@jaller94:${HOMESERVER_NAME}`],
    });

    await intent.underlyingClient.createRoom({
        name: 'Football - User B',
        room_alias_name: 'irc_inspircd_football-userb',
        invite: [`@jaller94:${HOMESERVER_NAME}`],
    });
}

async function hardcodedForRetreat() {
    const intent = appservice.getIntent('polychat');
    await intent.ensureRegistered();

    const mainRoomId = await intent.underlyingClient.createRoom({
        name: `Football ${new Date().toISOString()}`,
        // invite: [`@jaller94:${HOMESERVER_NAME}`],
    });

    const channel: Channel = {
        name: 'Football',
        mainRoomId,
        unclaimedSubRooms: [],
        claimedSubRooms: [],
        activeSubRooms: [],
    };

    channels.set('football', channel);
    for (const username of ['usera', 'userb']) {
        const roomId = await intent.ensureJoined(`#irc_inspircd_football-${username}:${HOMESERVER_NAME}`);
        channel.activeSubRooms.push({
            ready: new Date(),
            roomId,
            user: {
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
