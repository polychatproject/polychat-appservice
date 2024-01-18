import fs from 'node:fs';
import * as path from 'node:path';
import {
    Appservice,
    IAppserviceRegistration,
    SimpleFsStorageProvider,
    SimpleRetryJoinStrategy,
    AutojoinRoomsMixin,
    PowerLevelAction,
} from 'matrix-bot-sdk';
import { parse as parseYAML } from 'yaml';
import { uniqueId } from './helper';
import api from './api';
import { GenericTransformer } from './transformers/generic';

const DEBUG_MXID = process.env.DEBUG_MXID;
const API_BIND_ADDRESS = process.env.API_BIND_ADDRESS || '127.0.0.1';
const API_PORT = typeof process.env.API_PORT === 'string' ? Number.parseInt(process.env.API_PORT) : 9999;
const APPSERVICE_BIND_ADDRESS = process.env.APPSERVICE_BIND_ADDRESS || '127.0.0.1';
const APPSERVICE_PORT = typeof process.env.APPSERVICE_PORT === 'string' ? Number.parseInt(process.env.APPSERVICE_PORT) : 9999;
const HOMESERVER_NAME = process.env.HOMESERVER_NAME || 'localhost';
const HOMESERVER_URL = process.env.HOMESERVER_URL || 'http://localhost:8008';
const PATH_DATA = process.env.PATH_DATA || './data';
const PATH_CONFIG = process.env.PATH_CONFIG || './data';
const IRC_BRIDGE_MXID = process.env.IRC_BRIDGE_MXID;
const IRC_BRIDGE_SERVER = process.env.IRC_BRIDGE_SERVER;
const WHATSAPP_BRIDGE_MXID = process.env.WHATSAPP_BRIDGE_MXID;
const SIGNAL_BRIDGE_MXID = process.env.SIGNAL_BRIDGE_MXID;
const TELEGRAM_BRIDGE_MXID = process.env.TELEGRAM_BRIDGE_MXID;

const registration: IAppserviceRegistration = parseYAML(fs.readFileSync(path.join(PATH_CONFIG, 'registration.yaml'), 'utf8'));

const appservice = new Appservice({
    port: APPSERVICE_PORT,
    bindAddress: APPSERVICE_BIND_ADDRESS,
    homeserverName: HOMESERVER_NAME,
    homeserverUrl: HOMESERVER_URL,
    registration,
    storage: new SimpleFsStorageProvider(path.join(PATH_DATA, 'appservice.json')), // or any other IAppserviceStorageProvider
    joinStrategy: new SimpleRetryJoinStrategy(), // just to ensure reliable joins
});


export type SubRoomUser = {
    localpart: string,
    handOut: Date,
} & ({
    identity: 'inherit',
} | {
    identity: 'custom',
    displayName: string,
    avatar: string,
});

export type SubRoom = {
    ready?: Date,
    roomId: string,
    user?: SubRoomUser,
    url?: string,
}

export type Channel = {
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

function pushChannel(channel: Channel): void {
    channels.set(`c${uniqueId()}`, channel);
}

const ensureDisplayNameInRoom = async (roomId: string, localpart: string, displayName: string) => {
    // const intent = appservice.getIntent(localpart);
    // const event = await intent.underlyingClient.getRoomStateEvent(roomId, 'm.room.member', intent.userId);
    // if (event.content.displayname !== displayName) {
    //     await intent.underlyingClient.sendStateEvent(roomId, 'm.room.member', intent.userId, {
    //         ...event.content,
    //         displayname: displayName,
    //     });
    // }
};

const getDisplayNameForChannel = async (channel: Channel, subRoom: SubRoom, user: SubRoomUser): Promise<string> => {
    console.debug('Called getDisplayNameForChannel', channel.mainRoomId, user.localpart);
    if (user.identity === 'custom') {
        return user.displayName;
    }
    const mxid = `@${user.localpart}:${HOMESERVER_NAME}`;
    try {
        const state = (await intent.underlyingClient.getRoomStateEvent(subRoom.roomId, 'm.room.member', mxid));
        return state.displayname;
    } catch (error) {
        console.error(`Error fetching the displayname of ${mxid} in the sub room ${subRoom.roomId}.`);
        console.error(error);
        return 'Polychat user';
    }
};

const onMessageInSubRoom = async (subRoom: SubRoom, channel: Channel, event: any): Promise<void> => {
    console.debug('Called onMessageInSubRoom', {
        channel: channel.mainRoomId,
        event: event.event_id,
    });
    const polychatIntent = appservice.getIntent('polychat');
    if (event.sender === polychatIntent.userId) {
        // Ignore echo
        return;
    }

    const handOutRegExp = /^hand out (?<channelId>[a-z]+?) (?<network>[a-z]+?)$/;
    const body = event.content.body as string;
    const match = body.match(handOutRegExp);
    if (match) {
        try {
            const url = await handOutSubRoom(match.groups!['channelId']!, match.groups!['network']!);
            await polychatIntent.sendText(subRoom.roomId, `here you go ${url}`);
        } catch (error: any) {
            await polychatIntent.sendText(subRoom.roomId, `error ${error.message}`);
        }
        return;
    }

    // commands
    if (event.content.body === '!members') {
        const joinedMembers = await polychatIntent.underlyingClient.getJoinedRoomMembersWithProfiles(channel.mainRoomId);
        let text = 'Members:';
        for (const [mxid, member] of Object.entries(joinedMembers)) {
            if (mxid === polychatIntent.userId) {
                // Ignore Polychat bot
                continue;
            }
            text += `\n* ${member.display_name}`;
        }
        await polychatIntent.sendText(subRoom.roomId, text);
        return;
    }

    const user = subRoom.user;
    if (!user) {
        await polychatIntent.sendText(subRoom.roomId, 'Internal Error: No user identity set. Did you skip a step?');
        return;
    }

    const intent = appservice.getIntent(user.localpart);
    await ensureDisplayNameInRoom(channel.mainRoomId, user.localpart, await getDisplayNameForChannel(channel, subRoom, user));
    console.log('onMessageInSubRoom content', JSON.stringify(event.content));
    await intent.sendEvent(channel.mainRoomId, event.content);
};

const transformer = new GenericTransformer();

const onMessageInMainRoom = async (channel: Channel, event: any): Promise<void> => {
    const intent = appservice.getIntent('polychat');
    // const senderProfile = (await intent.underlyingClient.getRoomStateEvent(channel.mainRoomId, 'm.room.member', event.sender)).content;
    for (const subRoom of channel.activeSubRooms) {
        if (subRoom.user && event.sender === `@${subRoom.user.localpart}:${HOMESERVER_NAME}`) {
            // Don't send echo
            continue;
        }
        const { content } = await transformer.transformEventForNetwork(channel, event);
        console.log('onMessageInMainRoom content', JSON.stringify(content));
        intent.sendEvent(subRoom.roomId, content);
    }
};

const createChannel = async (opts: {name: string}): Promise<Channel> => {
    const intent = appservice.getIntent('polychat');
    await intent.ensureRegistered();

    const mainRoomId = await intent.underlyingClient.createRoom({
        name: `${opts.name} ${new Date().toISOString()}`,
    });
    if (DEBUG_MXID) {
        await intent.underlyingClient.inviteUser(DEBUG_MXID, mainRoomId);
        await intent.underlyingClient.setUserPowerLevel(DEBUG_MXID, mainRoomId, 50);
    }

    const channel: Channel = {
        name: opts.name,
        mainRoomId,
        unclaimedSubRooms: [],
        claimedSubRooms: [],
        activeSubRooms: [],
    };

    pushChannel(channel);

    createSubRoom({ channel, network: 'irc' });
    createSubRoom({ channel, network: 'irc' });

    return channel;
};

const createSubRoom = async (opts: {channel: Channel, network: string}) => {
    if (opts.network === 'irc') {
        if (!IRC_BRIDGE_MXID) {
            throw Error(`Network not configured: ${opts.network}`);
        }
        const roomId = await intent.underlyingClient.createRoom({
            name: opts.channel.name,
        });
        if (DEBUG_MXID) {
            await intent.underlyingClient.inviteUser(DEBUG_MXID, roomId);
            await intent.underlyingClient.setUserPowerLevel(DEBUG_MXID, roomId, 50);
        }
        await intent.underlyingClient.inviteUser(IRC_BRIDGE_MXID, roomId);

        const dmRoomId = await intent.underlyingClient.dms.getOrCreateDm(IRC_BRIDGE_MXID);
        const ircChannel = uniqueId('polychat_');
        await intent.underlyingClient.sendText(dmRoomId, `!plumb ${roomId} ${IRC_BRIDGE_SERVER} ${ircChannel}`);
        
        opts.channel.unclaimedSubRooms.push({
            ready: new Date(),
            roomId,
        });
        return;
    }
    throw Error(`Network not implemented: ${opts.network}`);
}

const onMessageInControlRoom = async (roomId: string, event: any): Promise<void> => {
    const handOutRegExp = /^create polychat (?<name>[a-zA-Z0-9]+?)$/;
    const body = event.content.body as string;
    const match = body.match(handOutRegExp);
    if (match) {
        const polychatIntent = appservice.getIntent('polychat');
        try {
            const url = await createChannel({ name: match.groups!['name']! })
            await polychatIntent.sendText(roomId, ` ${url}`);
        } catch (error: any) {
            await polychatIntent.sendText(roomId, `error ${error.message}`);
        }
        return;
    }
}

// Attach listeners here
appservice.on('room.message', async (roomId: string, event: any) => {
    if (!event['content']?.['msgtype']) return;

    const subRoomInfo = findSubRoom(roomId);
    if (subRoomInfo) {
        return onMessageInSubRoom(subRoomInfo.subRoom, subRoomInfo.channel, event);
    }

    const channel = findMainRoom(roomId);
    if (channel) {
        return onMessageInMainRoom(channel, event);
    }

    return onMessageInControlRoom(roomId, event);

    console.info(`Didn't know what to do with event in ${roomId}`);
});

appservice.on('room.event', async (roomId: string, event: any) => {
    console.debug('room.event', JSON.stringify(event));
    const polychatIntent = appservice.getIntent('polychat');
    if (event.sender === polychatIntent.userId) {
        // Ignore echo
        // TODO: We want to listen to our own changes, just not the initial sync
        return;
    }

    if (event['type'] === 'm.room.member') {
        // Sub room: Member joined or left
        const subRoomInfo = findSubRoom(roomId);
        if (subRoomInfo) {
            await onMessageInSubRoom(subRoomInfo.subRoom, subRoomInfo.channel, event);
            return;
        }

        // Main room: Member joined or left
        const channel = findMainRoom(roomId);
        if (channel) {
            console.info(`Main room: membership of ${event['state_key']} changed to ${event.content.membership}`);
            const intent = appservice.getIntent('polychat');
            // TODO: Find display name of user
            for (const subRoom of channel.activeSubRooms) {
                await intent.underlyingClient.sendNotice(subRoom.roomId, `${event['state_key']} changed to ${event.content.membership}`);
            }
        }
    }

    // Sync room name to sub rooms
    if (event['type'] === 'm.room.name' && event['state_key'] === '') {
        const channel = findMainRoom(roomId);
        if (channel) {
            console.info(`Main room: name changed ${JSON.stringify(event.content)}`);
            const intent = appservice.getIntent('polychat');
            for (const subRoom of channel.activeSubRooms) {
                await intent.underlyingClient.sendStateEvent(subRoom.roomId, 'm.room.name', '', event.content);
            }
        }
    }

    // Sync room avatar to sub rooms
    if (event['type'] === 'm.room.avatar' && event['state_key'] === '') {
        const channel = findMainRoom(roomId);
        if (channel) {
            console.info(`Main room: avatar changed ${JSON.stringify(event.content)}`);
            const intent = appservice.getIntent('polychat');
            for (const subRoom of channel.activeSubRooms) {
                await intent.underlyingClient.sendStateEvent(subRoom.roomId, 'm.room.avatar', '', event.content);
            }
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
            room_alias_name: `irc_#yoga-user${i}`,
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
        if (
            DEBUG_MXID
            && await intent.underlyingClient.userHasPowerLevelForAction(intent.userId, roomId, PowerLevelAction.Invite)
            && !(await intent.underlyingClient.getJoinedRoomMembers(roomId)).includes(DEBUG_MXID)
        ) {
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

// AppService
appservice.begin().then(() => {
    console.log(`AppService: Listening on ${APPSERVICE_BIND_ADDRESS}:${APPSERVICE_PORT}`);
}).then(hardcodedForRetreat);

// API
api.listen(API_PORT, API_BIND_ADDRESS, () => {
    console.info(`API: Listening on ${API_BIND_ADDRESS}:${API_PORT}`);
});
