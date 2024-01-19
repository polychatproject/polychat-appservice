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
const APPSERVICE_BIND_ADDRESS = process.env.APPSERVICE_BIND_ADDRESS || '0.0.0.0';
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
const TELEGRAM_BRIDGE_TUG_MXID = process.env.TELEGRAM_BRIDGE_TUG_MXID;
const TELEGRAM_BRIDGE_COMMAND_PREFIX = process.env.TELEGRAM_BRIDGE_COMMAND_PREFIX || '!tg';

console.debug('IRC_BRIDGE_MXID', IRC_BRIDGE_MXID);
console.debug('SIGNAL_BRIDGE_MXID', SIGNAL_BRIDGE_MXID);
console.debug('TELEGRAM_BRIDGE_MXID', TELEGRAM_BRIDGE_MXID);
console.debug('WHATSAPP_BRIDGE_MXID', WHATSAPP_BRIDGE_MXID);

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
    const subRoomIndex = polychat.unclaimedSubRooms.findIndex(subRoom => subRoom.roomId);
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

const getDisplayNameForPolychat = async (polychat: Polychat, subRoom: SubRoom, user: SubRoomUser): Promise<string> => {
    console.debug('Called getDisplayNameForPolychat', polychat.mainRoomId, user.localpart);
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

const onMessageInSubRoom = async (subRoom: SubRoom, polychat: Polychat, event: any): Promise<void> => {
    console.debug('Called onMessageInSubRoom', {
        polychat: polychat.mainRoomId,
        event: event.event_id,
    });
    const polychatIntent = appservice.getIntent(registration.sender_localpart);
    if (event.sender === polychatIntent.userId) {
        // Ignore echo
        return;
    }

    const handOutRegExp = /^hand out (?<polychatId>[a-z]+?) (?<network>[a-z]+?)$/;
    const body = event.content.body as string;
    const match = body.match(handOutRegExp);
    if (match) {
        try {
            const url = await handOutSubRoom(match.groups!['polychatId']!, match.groups!['network']!);
            await polychatIntent.sendText(subRoom.roomId, `here you go ${url}`);
        } catch (error: any) {
            await polychatIntent.sendText(subRoom.roomId, `error ${error.message}`);
        }
        return;
    }

    // commands
    if (event.content.body === '!members') {
        const joinedMembers = await polychatIntent.underlyingClient.getJoinedRoomMembersWithProfiles(polychat.mainRoomId);
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
    await ensureDisplayNameInRoom(polychat.mainRoomId, user.localpart, await getDisplayNameForPolychat(polychat, subRoom, user));
    console.log('onMessageInSubRoom content', JSON.stringify(event.content));
    await intent.sendEvent(polychat.mainRoomId, event.content);
};

const transformer = new GenericTransformer();

const onMessageInMainRoom = async (polychat: Polychat, event: any): Promise<void> => {
    const intent = appservice.getIntent(registration.sender_localpart);
    const userProfile = await intent.underlyingClient.getRoomStateEvent(polychat.mainRoomId, 'm.room.member', event.sender);
    // const senderProfile = (await intent.underlyingClient.getRoomStateEvent(polychat.mainRoomId, 'm.room.member', event.sender)).content;
    for (const subRoom of polychat.activeSubRooms) {
        if (subRoom.user && event.sender === `@${subRoom.user.localpart}:${HOMESERVER_NAME}`) {
            // Don't send echo
            continue;
        }
        const { content } = await transformer.transformEventForNetwork(polychat, userProfile, event);
        console.log('onMessageInMainRoom content', JSON.stringify(content));
        intent.sendEvent(subRoom.roomId, content);
    }
};

export const fillUpSubRoomPool = (polychat: Polychat) => {
    console.log(`Called fillUpSubRoomPool for ${polychat.mainRoomId}`)
    const networks = {
        irc: IRC_BRIDGE_MXID,
        telegram: TELEGRAM_BRIDGE_MXID,
        signal: SIGNAL_BRIDGE_MXID,
        whatsapp: WHATSAPP_BRIDGE_MXID,
    };

    for (const [network, mxid] of Object.entries(networks)) {
        if (!mxid) {
            // Network not configured
            console.debug(`fillUpSubRoomPool: MXID for ${network} not defined`);
            continue;
        }
        const unclaimedSubRooms = polychat.unclaimedSubRooms.filter(subRoom => subRoom.network === network);
        const missing = Math.max(2 - unclaimedSubRooms.length, 0);
        console.info(`Sub Room Pool: Creating ${missing} sub rooms for ${network} for ${polychat.mainRoomId}`);
        //TODO: Remove debug message
        appservice.getIntent('polychat').underlyingClient.sendNotice(polychat.mainRoomId, `Sub Room Pool: Creating ${missing} sub rooms for ${network} for ${polychat.mainRoomId}`);
        for (let i = 0; i < missing; i++) {
            createSubRoom({ polychat, network });
        }
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
        await appservice.getIntent(registration.sender_localpart).underlyingClient.sendNotice(opts.polychat.mainRoomId, `Created sub room ${roomId}`);
        if (DEBUG_MXID) {
            await intent.underlyingClient.inviteUser(DEBUG_MXID, roomId);
            await intent.underlyingClient.setUserPowerLevel(DEBUG_MXID, roomId, 50);
        }
        await intent.underlyingClient.inviteUser(IRC_BRIDGE_MXID, roomId);

        const dmRoomId = await intent.underlyingClient.dms.getOrCreateDm(IRC_BRIDGE_MXID);
        if (DEBUG_MXID && !(await intent.underlyingClient.getJoinedRoomMembers(dmRoomId)).includes(DEBUG_MXID)) {
            intent.underlyingClient.inviteUser(DEBUG_MXID, dmRoomId);
        }
        const ircChannel = uniqueId('polychat_');
        // TODO: Wait for join, then set up link
        setTimeout(() => {
            intent.underlyingClient.sendText(dmRoomId, `!plumb ${roomId} ${IRC_BRIDGE_SERVER} ${ircChannel}`);
        }, 15000);
        
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
        if (!TELEGRAM_BRIDGE_TUG_MXID) {
            throw Error(`TELEGRAM_BRIDGE_TUG_MXID required to open Telegram sub rooms`);
        }
        const roomId = await intent.underlyingClient.createRoom({
            name: opts.polychat.name,
        });
        if (DEBUG_MXID) {
            await intent.underlyingClient.inviteUser(DEBUG_MXID, roomId);
            await intent.underlyingClient.setUserPowerLevel(DEBUG_MXID, roomId, 50);
        }
        await intent.underlyingClient.inviteUser(TELEGRAM_BRIDGE_MXID, roomId);
        await intent.underlyingClient.inviteUser(TELEGRAM_BRIDGE_TUG_MXID, roomId);
        const tugIntent = appservice.getIntentForUserId(TELEGRAM_BRIDGE_TUG_MXID);
        await tugIntent.underlyingClient.joinRoom(roomId);
        // TODO: Wait for join, then set up link
        setTimeout(() => {
            intent.underlyingClient.sendText(roomId, `${TELEGRAM_BRIDGE_COMMAND_PREFIX} create group`);
            setTimeout(() => {
                tugIntent.underlyingClient.leaveRoom(roomId);
            }, 15000);
        }, 15000);
        // TODO: Get invite link

        opts.polychat.unclaimedSubRooms.push({
            network: opts.network,
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
        const polychatIntent = appservice.getIntent(registration.sender_localpart);
        try {
            const polychat = await createPolychat({ name: match.groups!['name']! });
            fillUpSubRoomPool(polychat);
            await polychatIntent.sendText(roomId, ` ${polychat.mainRoomId}`);
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

    const polychat = findMainRoom(roomId);
    if (polychat) {
        return onMessageInMainRoom(polychat, event);
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
            await onMessageInSubRoom(subRoomInfo.subRoom, subRoomInfo.polychat, event);
            return;
        }

        // Main room: Member joined or left
        const polychat = findMainRoom(roomId);
        if (polychat) {
            console.info(`Main room: membership of ${event['state_key']} changed to ${event.content.membership}`);
            const intent = appservice.getIntent(registration.sender_localpart);
            // TODO: Find display name of user
            for (const subRoom of polychat.activeSubRooms) {
                await intent.underlyingClient.sendNotice(subRoom.roomId, `${event['state_key']} changed to ${event.content.membership}`);
            }
        }
    }

    // Sync room name to sub rooms
    if (event['type'] === 'm.room.name' && event['state_key'] === '') {
        const polychat = findMainRoom(roomId);
        if (polychat) {
            console.info(`Main room: name changed ${JSON.stringify(event.content)}`);
            const intent = appservice.getIntent(registration.sender_localpart);
            for (const subRoom of polychat.activeSubRooms) {
                await intent.underlyingClient.sendStateEvent(subRoom.roomId, 'm.room.name', '', event.content);
            }
        }
    }

    // Sync room avatar to sub rooms
    if (event['type'] === 'm.room.avatar' && event['state_key'] === '') {
        const polychat = findMainRoom(roomId);
        if (polychat) {
            console.info(`Main room: avatar changed ${JSON.stringify(event.content)}`);
            const intent = appservice.getIntent(registration.sender_localpart);
            for (const subRoom of polychat.activeSubRooms) {
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
    const polychat = await createPolychat({
        name: 'Retreat in Binz',
    });

    fillUpSubRoomPool(polychat);

    // for (const username of ['usera', 'userb']) {
    //     const roomId = await intent.ensureJoined(`#irc_#football-${username}:${HOMESERVER_NAME}`);
    //     if (
    //         DEBUG_MXID
    //         && await intent.underlyingClient.userHasPowerLevelForAction(intent.userId, roomId, PowerLevelAction.Invite)
    //         && !(await intent.underlyingClient.getJoinedRoomMembers(roomId)).includes(DEBUG_MXID)
    //     ) {
    //         await intent.underlyingClient.inviteUser(DEBUG_MXID, roomId);
    //         await intent.underlyingClient.setUserPowerLevel(DEBUG_MXID, roomId, 50);
    //     }
    //     polychat.activeSubRooms.push({
    //         network: 'irc',
    //         ready: new Date(),
    //         roomId,
    //         user: {
    //             localpart: uniqueId('polychat_'),
    //             handOut: new Date(),
    //             identity: 'inherit',
    //         },
    //     });
    // }
}

// AppService
appservice.begin().then(() => {
    console.log(`AppService: Listening on ${APPSERVICE_BIND_ADDRESS}:${APPSERVICE_PORT}`);
}).then(hardcodedForRetreat);

// API
api.listen(API_PORT, API_BIND_ADDRESS, () => {
    console.info(`API: Listening on ${API_BIND_ADDRESS}:${API_PORT}`);
});
