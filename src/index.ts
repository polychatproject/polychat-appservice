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
const API_BIND_ADDRESS = process.env.API_BIND_ADDRESS || '0.0.0.0';
const API_PORT = typeof process.env.API_PORT === 'string' ? Number.parseInt(process.env.API_PORT) : 9998;
const APPSERVICE_BIND_ADDRESS = process.env.APPSERVICE_BIND_ADDRESS || '127.0.0.1';
const APPSERVICE_PORT = typeof process.env.APPSERVICE_PORT === 'string' ? Number.parseInt(process.env.APPSERVICE_PORT) : 9999;
const HOMESERVER_NAME = process.env.HOMESERVER_NAME || 'localhost';
const HOMESERVER_URL = process.env.HOMESERVER_URL || 'http://localhost:8008';
const PATH_DATA = process.env.PATH_DATA || './data';
const PATH_CONFIG = process.env.PATH_CONFIG || './config';
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
    network: string,
    ready?: Date,
    roomId: string,
    user?: SubRoomUser,
    url?: string,
}

export type Polychat = {
    name: string,
    avatar?: string,
    mainRoomId: string,
    unclaimedSubRooms: SubRoom[],
    claimedSubRooms: SubRoom[],
    activeSubRooms: SubRoom[],
};

const polychats: Polychat[] = [];

async function handOutSubRoom(polychatId: string, network: string): Promise<string> {
    const polychat = polychats.find(polychat => polychat.mainRoomId === polychatId);
    if (!polychat) {
        throw Error('E_POLYCHAT_NOT_FOUND');
    }
    const subRoomIndex = polychat.unclaimedSubRooms.findIndex(subRoom => subRoom.)
    if (subRoomIndex === -1) {
        throw Error('E_OUT_OF_SUB_ROOMS');
    }
    const subRoom = polychat.unclaimedSubRooms[subRoomIndex]!;
    polychat.unclaimedSubRooms.splice(subRoomIndex, 1);
    subRoom.user = {
        localpart: uniqueId('polychat_'),
        identity: 'inherit',
        handOut: new Date(),
    };
    const intent = appservice.getIntent(registration.sender_localpart);
    const userIntent = appservice.getIntent(subRoom.user.localpart);
    await intent.underlyingClient.sendStateEvent(polychat.mainRoomId, 'de.polychat.room.participant', userIntent.userId, {
        room_id: subRoom.roomId,
    });
    polychat.claimedSubRooms.push(subRoom);
    return subRoom.url!;
}

function findSubRoom(roomId: string): { polychat: Polychat, subRoom: SubRoom } | undefined {
    for (const polychat of polychats) {
        const subRoom = [...polychat.activeSubRooms].find(r => r.roomId === roomId);
        if (subRoom) {
            return {
                polychat,
                subRoom,
            };
        }
    }
}

function findMainRoom(roomId: string): Polychat | undefined {
    for (const polychat of polychats) {
        if (polychat.mainRoomId === roomId) {
            return polychat;
        }
    }
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

const getDisplayNameForPolychat = async (channel: Polychat, subRoom: SubRoom, user: SubRoomUser): Promise<string> => {
    console.debug('Called getDisplayNameForPolychat', channel.mainRoomId, user.localpart);
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

const onMessageInSubRoom = async (subRoom: SubRoom, channel: Polychat, event: any): Promise<void> => {
    console.debug('Called onMessageInSubRoom', {
        channel: channel.mainRoomId,
        event: event.event_id,
    });
    const polychatIntent = appservice.getIntent(registration.sender_localpart);
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
    await ensureDisplayNameInRoom(channel.mainRoomId, user.localpart, await getDisplayNameForPolychat(channel, subRoom, user));
    console.log('onMessageInSubRoom content', JSON.stringify(event.content));
    await intent.sendEvent(channel.mainRoomId, event.content);
};

const transformer = new GenericTransformer();

const onMessageInMainRoom = async (channel: Polychat, event: any): Promise<void> => {
    const intent = appservice.getIntent(registration.sender_localpart);
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

export const createPolychat = async (opts: {name: string}): Promise<Polychat> => {
    const intent = appservice.getIntent(registration.sender_localpart);

    const mainRoomId = await intent.underlyingClient.createRoom({
        name: `${opts.name} ${new Date().toISOString()}`,
    });
    if (DEBUG_MXID) {
        await intent.underlyingClient.inviteUser(DEBUG_MXID, mainRoomId);
        await intent.underlyingClient.setUserPowerLevel(DEBUG_MXID, mainRoomId, 50);
    }

    const polychat: Polychat = {
        name: opts.name,
        mainRoomId,
        unclaimedSubRooms: [],
        claimedSubRooms: [],
        activeSubRooms: [],
    };

    polychats.push(polychat);

    createSubRoom({ polychat, network: 'irc' });
    createSubRoom({ polychat, network: 'irc' });

    return polychat;
};

const createSubRoom = async (opts: {polychat: Polychat, network: string}) => {
    console.debug('Called createSubRoom', {
        polychat: opts.polychat.mainRoomId,
        network: opts.network,
    });
    if (opts.network === 'irc') {
        if (!IRC_BRIDGE_MXID) {
            throw Error(`Network not configured: ${opts.network}`);
        }
        const roomId = await intent.underlyingClient.createRoom({
            name: opts.polychat.name,
        });
        if (DEBUG_MXID) {
            await intent.underlyingClient.inviteUser(DEBUG_MXID, roomId);
            await intent.underlyingClient.setUserPowerLevel(DEBUG_MXID, roomId, 50);
        }
        await intent.underlyingClient.inviteUser(IRC_BRIDGE_MXID, roomId);

        const dmRoomId = await intent.underlyingClient.dms.getOrCreateDm(IRC_BRIDGE_MXID);
        const ircChannel = uniqueId('polychat_');
        await intent.underlyingClient.sendText(dmRoomId, `!plumb ${roomId} ${IRC_BRIDGE_SERVER} ${ircChannel}`);
        
        opts.polychat.unclaimedSubRooms.push({
            network: opts.network,
            ready: new Date(),
            roomId,
        });
        return;
    } else if (opts.network === 'telegram') {
        if (!TELEGRAM_BRIDGE_MXID) {
            throw Error(`Network not configured: ${opts.network}`);
        }
        const roomId = await intent.underlyingClient.createRoom({
            name: opts.polychat.name,
        });
        if (DEBUG_MXID) {
            await intent.underlyingClient.inviteUser(DEBUG_MXID, roomId);
            await intent.underlyingClient.setUserPowerLevel(DEBUG_MXID, roomId, 50);
        }
        await intent.underlyingClient.inviteUser(TELEGRAM_BRIDGE_MXID, roomId);
    }
    throw Error(`Network not implemented: ${opts.network}`);
}

const onMessageInControlRoom = async (roomId: string, event: any): Promise<void> => {
    const handOutRegExp = /^create polychat (?<name>[a-zA-Z0-9]+?)$/;
    const body = event.content.body as string;
    const match = body.match(handOutRegExp);
    if (match) {
        const polychatIntent = appservice.getIntent(registration.sender_localpart);
        try {
            const url = await createPolychat({ name: match.groups!['name']! })
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
        return onMessageInSubRoom(subRoomInfo.subRoom, subRoomInfo.polychat, event);
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
    const polychatIntent = appservice.getIntent(registration.sender_localpart);
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
            const intent = appservice.getIntent(registration.sender_localpart);
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
            const intent = appservice.getIntent(registration.sender_localpart);
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
            const intent = appservice.getIntent(registration.sender_localpart);
            for (const subRoom of channel.activeSubRooms) {
                await intent.underlyingClient.sendStateEvent(subRoom.roomId, 'm.room.avatar', '', event.content);
            }
        }
    }
});

// Typically appservices will want to autojoin all rooms
AutojoinRoomsMixin.setupOnAppservice(appservice);

const intent = appservice.getIntent(registration.sender_localpart);
await intent.ensureRegistered();

async function createRooms() {
    const intent = appservice.getIntent(registration.sender_localpart);
    const mainRoomId = await intent.underlyingClient.createRoom({
        name: 'Yoga',
        ...(DEBUG_MXID && {
            invite: [DEBUG_MXID],
        }),
    });

    const polychat: Polychat = {
        name: 'Yoga',
        mainRoomId,
        unclaimedSubRooms: [],
        claimedSubRooms: [],
        activeSubRooms: [],
    };

    polychats.push(polychat);

    for (let i = 0; i < 4; i++) {
        const roomId = await intent.underlyingClient.createRoom({
            name: 'Yoga',
            room_alias_name: `irc_#yoga-user${i}`,
            ...(DEBUG_MXID && {
                invite: [DEBUG_MXID],
            }),
        });
        polychat.unclaimedSubRooms.push({
            network: 'irc',
            ready: new Date(),
            roomId,
        });
    }
}

async function hardcodedFootballCreationForChristian() {
    const intent = appservice.getIntent(registration.sender_localpart);

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
    const intent = appservice.getIntent(registration.sender_localpart);

    const mainRoomId = await intent.underlyingClient.createRoom({
        name: `Football ${new Date().toISOString()}`,
    });
    if (DEBUG_MXID) {
        await intent.underlyingClient.inviteUser(DEBUG_MXID, mainRoomId);
        await intent.underlyingClient.setUserPowerLevel(DEBUG_MXID, mainRoomId, 50);
    }

    const polychat: Polychat = {
        name: 'Football',
        mainRoomId,
        unclaimedSubRooms: [],
        claimedSubRooms: [],
        activeSubRooms: [],
    };

    polychats.push(polychat);
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
        polychat.activeSubRooms.push({
            network: 'irc',
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
});

// API
api.listen(API_PORT, API_BIND_ADDRESS, () => {
    console.info(`API: Listening on ${API_BIND_ADDRESS}:${API_PORT}`);
});
