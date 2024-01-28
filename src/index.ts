import fs from 'node:fs';
import * as path from 'node:path';
import {
    Appservice,
    IAppserviceRegistration,
    SimpleFsStorageProvider,
    SimpleRetryJoinStrategy,
    AutojoinRoomsMixin,
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
const SIGNAL_BRIDGE_MXID = process.env.SIGNAL_BRIDGE_MXID;
const SIGNAL_BRIDGE_ACCOUNT_MXIDS = typeof process.env.SIGNAL_BRIDGE_ACCOUNT_MXIDS === 'string' ? process.env.SIGNAL_BRIDGE_ACCOUNT_MXIDS.split(',') : [];
const SIGNAL_BRIDGE_COMMAND_PREFIX = process.env.SIGNAL_BRIDGE_COMMAND_PREFIX || '!signal';
const TELEGRAM_BRIDGE_MXID = process.env.TELEGRAM_BRIDGE_MXID;
const TELEGRAM_BRIDGE_ACCOUNT_MXIDS = typeof process.env.TELEGRAM_BRIDGE_ACCOUNT_MXIDS === 'string' ? process.env.TELEGRAM_BRIDGE_ACCOUNT_MXIDS.split(',') : [];
const TELEGRAM_BRIDGE_TUG_MXID = process.env.TELEGRAM_BRIDGE_TUG_MXID;
const TELEGRAM_BRIDGE_COMMAND_PREFIX = process.env.TELEGRAM_BRIDGE_COMMAND_PREFIX || '!tg';
const WHATSAPP_BRIDGE_MXID = process.env.WHATSAPP_BRIDGE_MXID;
const WHATSAPP_BRIDGE_ACCOUNT_MXIDS = typeof process.env.WHATSAPP_BRIDGE_ACCOUNT_MXIDS === 'string' ? process.env.WHATSAPP_BRIDGE_ACCOUNT_MXIDS.split(',') : [];
const WHATSAPP_BRIDGE_COMMAND_PREFIX = process.env.WHATSAPP_BRIDGE_COMMAND_PREFIX || '!wa';

type Network = 'irc' | 'signal' | 'telegram' | 'whatsapp';

enum PolychatStateEventType {
    room = 'de.polychat.room',
    participant = 'de.polychat.room.participant',
};

enum PolychatRoomTypes {
    main = 'main',
    sub = 'sub',
    control = 'control',
}

type PolychatStateEventRoom = {
    type: PolychatRoomTypes.main
} & {
    type: PolychatRoomTypes.control | PolychatRoomTypes.sub,
    network: string,
};

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
} & ({
    identity: 'inherit',
} | {
    identity: 'custom',
    displayName: string,
    avatar: string,
});

export type UnclaimedSubRoom = {
    polychatUserId: string,
    network: string,
    ready?: Date,
    roomId: string,
    inviteUrl?: string,
};

export type ControlRoom = {
    network: string,
    ready?: Date,
    roomId: string,
};

export type ClaimedSubRoom = UnclaimedSubRoom & {
    claimed: Date,
    user: SubRoomUser,
};

export type SubRoom = UnclaimedSubRoom | ClaimedSubRoom;

export type Polychat = {
    name: string,
    avatar?: string,
    mainRoomId: string,
    subRooms: ClaimedSubRoom[],
};

const polychats: Polychat[] = [];
const unclaimedSubRooms: Map<Network, SubRoom[]> = new Map([
    ['irc', []],
    ['signal', []],
    ['telegram', []],
    ['whatsapp', []],
]);

async function claimSubRoom(polychat: Polychat, network: Network, userDisplayName?: string): Promise<string> {
    const unclaimedSubRoomsForThisNetwork = unclaimedSubRooms.get(network);
    if (!Array.isArray(unclaimedSubRoomsForThisNetwork)) {
        throw Error('E_NO_SUB_ROOM_FOR_THIS_NETWORK');
    }
    const subRoomIndex = unclaimedSubRoomsForThisNetwork.findIndex(subRoom => subRoom.roomId);
    if (subRoomIndex === -1) {
        throw Error('E_OUT_OF_SUB_ROOMS');
    }
    const subRoom = unclaimedSubRoomsForThisNetwork[subRoomIndex]!;
    unclaimedSubRoomsForThisNetwork.splice(subRoomIndex, 1);
    const claimedSubRoom: ClaimedSubRoom = {
        ...subRoom,
        claimed: new Date(),
        user: typeof userDisplayName !== 'string' ? {
            localpart: uniqueId('polychat_'),
            identity: 'inherit',
        } : {
            localpart: uniqueId('polychat_'),
            identity: 'custom',
            displayName: userDisplayName,
            avatar: '',
        },
    };
    const intent = appservice.getIntent(registration.sender_localpart);
    const userIntent = appservice.getIntent(claimedSubRoom.user.localpart);
    await intent.underlyingClient.sendStateEvent(polychat.mainRoomId, PolychatStateEventType.participant, userIntent.userId, {
        room_id: subRoom.roomId,
    });
    polychat.subRooms.push(claimedSubRoom);
    
    // Refill the Sub Room Pool
    fillUpSubRoomPool();

    return subRoom.inviteUrl!;
}

function findActiveSubRoom(roomId: string): { polychat: Polychat, subRoom: ClaimedSubRoom } | undefined {
    for (const polychat of polychats) {
        const subRoom = polychat.subRooms.find(r => r.roomId === roomId);
        if (subRoom) {
            return {
                polychat,
                subRoom,
            };
        }
    }
}

function findUnclaimedSubRoom(roomId: string): { subRoom: SubRoom } | undefined {
    for (const subRooms of unclaimedSubRooms.values()) {
        const subRoom = subRooms.find(r => r.roomId === roomId);
        if (subRoom) {
            return {
                subRoom,
            };
        }
    }
}

function findAnySubRoom(roomId: string): { polychat?: Polychat, subRoom: SubRoom } | undefined {
    return findUnclaimedSubRoom(roomId) ?? findActiveSubRoom(roomId);
}

export function findMainRoom(roomId: string): Polychat | undefined {
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
    const intent = appservice.getIntent(user.localpart);
    try {
        // TODO: The event is sometimes not found
        const state = (await intent.underlyingClient.getRoomStateEvent(subRoom.roomId, 'm.room.member', intent.userId));
        return state.displayname;
    } catch (error) {
        console.error(`Error fetching the displayname of ${intent.userId} in the sub room ${subRoom.roomId}.`);
        console.error(error);
        return 'Polychat user';
    }
};

const onMessageInClaimedSubRoom = async (subRoom: ClaimedSubRoom, polychat: Polychat, event: any): Promise<void> => {
    console.debug('Called onMessageInClaimedSubRoom', {
        polychat: polychat.mainRoomId,
        event: event.event_id,
    });
    const polychatIntent = appservice.getIntentForUserId(subRoom.polychatUserId);
    if (event.sender === polychatIntent.userId) {
        // Ignore echo
        return;
    }

    // TODO: Move command to control rooms
    const claimRegExp = /^claim (?<polychatId>[a-z]+?) (?<network>[a-z]+?)$/;
    const body = event.content.body as string;
    const match = body.match(claimRegExp);
    if (match) {
        const polychat = findMainRoom(match.groups!['polychatId']!);
        if (!polychat) {
            await polychatIntent.sendText(subRoom.roomId, `Could not find Polychat. Command: claim <polychat> <network>`);
            return;
        }
        try {
            const network = match.groups!['network'] as Network; // TODO: unsafe case
            const url = await claimSubRoom(polychat, network);
            await polychatIntent.sendText(subRoom.roomId, `Invite Url: ${url}`);
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

    const cleanedContent = { ...event.content };
    delete cleanedContent['fi.mau.telegram.source'];
    
    await intent.sendEvent(polychat.mainRoomId, cleanedContent);
};

const transformer = new GenericTransformer();

const catchTelegramInviteLinks = async (roomId: string, event: any): Promise<void> => {
    if (event.content.msgtype !== 'notice') {
        return;
    }
    const body = event.content.body as unknown;
    if (typeof body !== 'string' || !body.startsWith('Invite link to ')) {
        return;
    }
    const subRoomInfo = findAnySubRoom(roomId);
    if (!subRoomInfo) {
        return;
    }
    const { polychat, subRoom } = subRoomInfo;
    if (event.sender !== TELEGRAM_BRIDGE_MXID) {
        return;
    }
    const match = body.match(/: (?<link>https:\/\/t\.me\/\+[a-zA-Z0-9]+)$/);
    if (!match) {
        return;
    }
    const inviteLink = match.groups!['link'];
    subRoom.inviteUrl = inviteLink;
};

const onMessageInMainRoom = async (polychat: Polychat, event: any): Promise<void> => {
    const intent = appservice.getIntent(registration.sender_localpart);
    const userProfile = await intent.underlyingClient.getRoomStateEvent(polychat.mainRoomId, 'm.room.member', event.sender);
    // const senderProfile = (await intent.underlyingClient.getRoomStateEvent(polychat.mainRoomId, 'm.room.member', event.sender)).content;
    for (const subRoom of polychat.subRooms) {
        if (subRoom.user && event.sender === appservice.getIntent(subRoom.user.localpart).userId) {
            // Don't send echo
            continue;
        }
        const { content } = await transformer.transformEventForNetwork(polychat, userProfile, event);
        console.log('onMessageInMainRoom content', JSON.stringify(content));
        const polychatIntent = appservice.getIntentForUserId(subRoom.polychatUserId);
        polychatIntent.sendEvent(subRoom.roomId, content);
    }
};

export const fillUpSubRoomPool = () => {
    console.log(`Called fillUpSubRoomPool`)
    const networks: Map<Network, string | undefined> = new Map([
        ['irc', IRC_BRIDGE_MXID],
        ['telegram', TELEGRAM_BRIDGE_MXID],
        ['signal', SIGNAL_BRIDGE_MXID],
        ['whatsapp', WHATSAPP_BRIDGE_MXID],
    ]);

    for (const [network, mxid] of networks.entries()) {
        if (!mxid) {
            // Network not configured
            console.debug(`fillUpSubRoomPool: MXID for ${network} not defined`);
            continue;
        }
        const unclaimedSubRoomsForThisNetwork = unclaimedSubRooms.get(network);
        if (unclaimedSubRoomsForThisNetwork === undefined) {
            console.warn(`INTERNAL ERROR: No array of unclaimed sub room for network ${network}`)
            continue;
        }
        const missing = Math.max(2 - unclaimedSubRoomsForThisNetwork.length, 0);
        console.info(`Sub Room Pool: Creating ${missing} sub rooms for ${network}`);
        for (let i = 0; i < missing; i++) {
            createSubRoom({ network });
        }
    }
};

export const createPolychat = async (opts: {name: string}): Promise<Polychat> => {
    const intent = appservice.getIntent(registration.sender_localpart);

    const mainRoomId = await intent.underlyingClient.createRoom({
        name: `${opts.name} ${new Date().toISOString()}`,
        initial_state: [
            {
                type: PolychatStateEventType.room,
                content: {
                    type: 'main',
                },
            },
        ],
    });
    if (DEBUG_MXID) {
        await intent.underlyingClient.inviteUser(DEBUG_MXID, mainRoomId);
        await intent.underlyingClient.setUserPowerLevel(DEBUG_MXID, mainRoomId, 50);
    }

    const polychat: Polychat = {
        name: opts.name,
        mainRoomId,
        subRooms: [],
    };

    polychats.push(polychat);

    return polychat;
};

const createSubRoom = async (opts: {name?: string, network: Network}) => {
    console.debug('Called createSubRoom', {
        network: opts.network,
    });
    if (opts.network === 'irc') {
        if (!IRC_BRIDGE_MXID) {
            throw Error(`Network not configured: ${opts.network}`);
        }
        const intent = appservice.getIntent(registration.sender_localpart);
        const roomId = await intent.underlyingClient.createRoom({
            name: opts.name,
            initial_state: [
                {
                    type: PolychatStateEventType.room,
                    content: {
                        type: 'sub',
                        network: opts.network,
                    },
                },
            ],
        });
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
        
        unclaimedSubRooms.get('irc')!.push({
            network: opts.network,
            polychatUserId: intent.userId,
            ready: new Date(),
            roomId,
        });
        return;  
    } else if (opts.network === 'signal') {
        if (!SIGNAL_BRIDGE_MXID) {
            throw Error(`Network not configured: ${opts.network}`);
        }
        if (SIGNAL_BRIDGE_ACCOUNT_MXIDS.length === 0) {
            throw Error(`SIGNAL_BRIDGE_ACCOUNT_MXIDS required to open WhatsApp sub rooms`);
        }
        const intent = appservice.getIntentForUserId(SIGNAL_BRIDGE_ACCOUNT_MXIDS[0]!);
        const roomId = await intent.underlyingClient.createRoom({
            name: opts.name,
            initial_state: [
                {
                    type: PolychatStateEventType.room,
                    content: {
                        type: 'sub',
                        network: opts.network,
                    },
                },
            ],
        });
        if (DEBUG_MXID) {
            console.log(`createSubRoom: Invite DEBUG_MXID to ${roomId}`);
            await intent.underlyingClient.inviteUser(DEBUG_MXID, roomId);
            await intent.underlyingClient.setUserPowerLevel(DEBUG_MXID, roomId, 50);
        }
        console.log(`createSubRoom: Invite SIGNAL_BRIDGE_MXID to ${roomId}`);
        await intent.underlyingClient.inviteUser(SIGNAL_BRIDGE_MXID, roomId);
        
        // The Signal bot wants to be able to redact events
        console.log(`createSubRoom: Set power level of SIGNAL_BRIDGE_MXID to 50 in ${roomId}`);
        await intent.underlyingClient.setUserPowerLevel(SIGNAL_BRIDGE_MXID, roomId, 50);
        console.log(`createSubRoom: Join as SIGNAL_BRIDGE_TUG_MXID to ${roomId}`);
        // TODO: Wait for join, then set up link
        setTimeout(() => {
            console.log(`createSubRoom: Send "create group" command to ${roomId}`);
            intent.underlyingClient.sendText(roomId, `${SIGNAL_BRIDGE_COMMAND_PREFIX} create`);
            // TODO: Wait for link, then get invite link
            setTimeout(() => {
                console.log(`createSubRoom: Send "invite-link" to ${roomId}`);
                intent.underlyingClient.sendText(roomId, `${SIGNAL_BRIDGE_COMMAND_PREFIX} invite-link`);
            }, 15000);
        }, 15000);

        unclaimedSubRooms.get('signal')!.push({
            network: opts.network,
            polychatUserId: intent.userId,
            ready: new Date(),
            roomId,
        });
        return;
    } else if (opts.network === 'telegram') {
        if (!TELEGRAM_BRIDGE_MXID) {
            throw Error(`Network not configured: ${opts.network}`);
        }
        if (TELEGRAM_BRIDGE_ACCOUNT_MXIDS.length === 0) {
            throw Error(`TELEGRAM_BRIDGE_ACCOUNT_MXIDS required to open Telegram sub rooms`);
        }
        if (!TELEGRAM_BRIDGE_TUG_MXID) {
            throw Error(`TELEGRAM_BRIDGE_TUG_MXID required to open Telegram sub rooms`);
        }
        const intent = appservice.getIntentForUserId(TELEGRAM_BRIDGE_ACCOUNT_MXIDS[0]!);
        const roomId = await intent.underlyingClient.createRoom({
            name: opts.name,
            initial_state: [
                {
                    type: 'de.polychat.room',
                    content: {
                        type: 'sub',
                        network: opts.network,
                    },
                },
            ],
        });
        if (DEBUG_MXID) {
            console.log(`createSubRoom: Invite DEBUG_MXID to ${roomId}`);
            await intent.underlyingClient.inviteUser(DEBUG_MXID, roomId);
            await intent.underlyingClient.setUserPowerLevel(DEBUG_MXID, roomId, 50);
        }
        console.log(`createSubRoom: Invite TELEGRAM_BRIDGE_MXID to ${roomId}`);
        await intent.underlyingClient.inviteUser(TELEGRAM_BRIDGE_MXID, roomId);
        
        // The Telegram bot wants to be able to redact events
        console.log(`createSubRoom: Set power level of TELEGRAM_BRIDGE_MXID to 50 in ${roomId}`);
        await intent.underlyingClient.setUserPowerLevel(TELEGRAM_BRIDGE_MXID, roomId, 50);
        console.log(`createSubRoom: Invite TELEGRAM_BRIDGE_TUG_MXID to ${roomId}`);
        await intent.underlyingClient.inviteUser(TELEGRAM_BRIDGE_TUG_MXID, roomId);
        const tugIntent = appservice.getIntentForUserId(TELEGRAM_BRIDGE_TUG_MXID);
        console.log(`createSubRoom: Join as TELEGRAM_BRIDGE_TUG_MXID to ${roomId}`);
        await tugIntent.joinRoom(roomId);
        // TODO: Wait for join, then set up link
        setTimeout(() => {
            console.log(`createSubRoom: Send "create group" command to ${roomId}`);
            intent.underlyingClient.sendText(roomId, `${TELEGRAM_BRIDGE_COMMAND_PREFIX} create group`);
            // TODO: Wait for link, then get invite link
            setTimeout(() => {
                console.log(`createSubRoom: Send "invite-link" to ${roomId}`);
                intent.underlyingClient.sendText(roomId, `${TELEGRAM_BRIDGE_COMMAND_PREFIX} invite-link`);
                tugIntent.leaveRoom(roomId);
            }, 15000);
        }, 15000);

        unclaimedSubRooms.get('telegram')!.push({
            network: opts.network,
            polychatUserId: intent.userId,
            ready: new Date(),
            roomId,
        });
        return;
    } else if (opts.network === 'whatsapp') {
        if (!WHATSAPP_BRIDGE_MXID) {
            throw Error(`Network not configured: ${opts.network}`);
        }
        if (WHATSAPP_BRIDGE_ACCOUNT_MXIDS.length === 0) {
            throw Error(`WHATSAPP_BRIDGE_ACCOUNT_MXIDS required to open WhatsApp sub rooms`);
        }
        const intent = appservice.getIntentForUserId(WHATSAPP_BRIDGE_ACCOUNT_MXIDS[0]!);
        const roomId = await intent.underlyingClient.createRoom({
            name: opts.name,
            initial_state: [
                {
                    type: 'de.polychat.room',
                    content: {
                        type: 'sub',
                        network: opts.network,
                    },
                },
            ],
        });
        if (DEBUG_MXID) {
            console.log(`createSubRoom: Invite DEBUG_MXID to ${roomId}`);
            await intent.underlyingClient.inviteUser(DEBUG_MXID, roomId);
            await intent.underlyingClient.setUserPowerLevel(DEBUG_MXID, roomId, 50);
        }
        console.log(`createSubRoom: Invite WHATSAPP_BRIDGE_MXID to ${roomId}`);
        await intent.underlyingClient.inviteUser(WHATSAPP_BRIDGE_MXID, roomId);
        
        // The WhatsApp bot wants to be able to redact events
        console.log(`createSubRoom: Set power level of WHATSAPP_BRIDGE_MXID to 50 in ${roomId}`);
        await intent.underlyingClient.setUserPowerLevel(WHATSAPP_BRIDGE_MXID, roomId, 50);
        console.log(`createSubRoom: Join as WHATSAPP_BRIDGE_TUG_MXID to ${roomId}`);
        // TODO: Wait for join, then set up link
        setTimeout(() => {
            console.log(`createSubRoom: Send "create group" command to ${roomId}`);
            intent.underlyingClient.sendText(roomId, `${WHATSAPP_BRIDGE_COMMAND_PREFIX} create`);
            // TODO: Wait for link, then get invite link
            setTimeout(() => {
                console.log(`createSubRoom: Send "invite-link" to ${roomId}`);
                intent.underlyingClient.sendText(roomId, `${WHATSAPP_BRIDGE_COMMAND_PREFIX} invite-link`);
            }, 15000);
        }, 15000);

        unclaimedSubRooms.get('whatsapp')!.push({
            network: opts.network,
            polychatUserId: intent.userId,
            ready: new Date(),
            roomId,
        });
        return;
    }
    throw Error(`Network not implemented: ${opts.network}`);
}

const onMessageInControlRoom = async (roomId: string, event: any): Promise<void> => {
    const handOutRegExp = /^create polychat (?<name>.+)$/;
    const polychatIntent = appservice.getIntent(registration.sender_localpart);
    if (typeof event.content.body !== 'string') {
        try {
            await polychatIntent.sendText(roomId, 'body is not defined');
        } catch {}
        return;
    }
    const body = event.content.body as string;
    const match = body.match(handOutRegExp);
    if (match) {
        try {
            const polychat = await createPolychat({ name: match.groups!['name']! });
            await polychatIntent.sendText(roomId, `created ${polychat.mainRoomId}`);
        } catch (error: any) {
            await polychatIntent.sendText(roomId, `error ${error.message}`);
        }
        return;
    }
}

// Attach listeners here
appservice.on('room.message', async (roomId: string, event: any) => {
    if (!event['content']?.['msgtype']) return;

    await catchTelegramInviteLinks(roomId, event);

    const subRoomInfo = findActiveSubRoom(roomId);
    if (subRoomInfo) {
        return onMessageInClaimedSubRoom(subRoomInfo.subRoom, subRoomInfo.polychat, event);
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
        const subRoomInfo = findActiveSubRoom(roomId);
        if (subRoomInfo) {
            // TODO: Detect main user
            return;
        }

        // Main room: Member joined or left
        const polychat = findMainRoom(roomId);
        if (polychat) {
            let msg = '';
            if (event.content.membership === 'join') {
                msg = `${event['state_key']} joined.`;
            }
            if (event.content.membership === 'leave') {
                msg = `${event['state_key']} left.`;
            }
            if (event.content.membership === 'ban') {
                msg = `${event['state_key']} got banned.`;
            }
            if (!msg) {
                return;
            }
            console.info(`Main room: membership of ${event['state_key']} changed to ${event.content.membership}`);
            // TODO: Find display name of user
            for (const subRoom of polychat.subRooms) {
                const intent = appservice.getIntentForUserId(subRoom.polychatUserId);
                await intent.underlyingClient.sendNotice(subRoom.roomId, msg);
            }
        }
    }

    // Sync room name to sub rooms
    if (event['type'] === 'm.room.name' && event['state_key'] === '') {
        const polychat = findMainRoom(roomId);
        if (polychat) {
            console.info(`Main room: name changed ${JSON.stringify(event.content)}`);
            for (const subRoom of polychat.subRooms) {
                const intent = appservice.getIntentForUserId(subRoom.polychatUserId);
                await intent.underlyingClient.sendStateEvent(subRoom.roomId, 'm.room.name', '', event.content);
            }
        }
    }

    // Sync room avatar to sub rooms
    if (event['type'] === 'm.room.avatar' && event['state_key'] === '') {
        const polychat = findMainRoom(roomId);
        if (polychat) {
            console.info(`Main room: avatar changed ${JSON.stringify(event.content)}`);
            for (const subRoom of polychat.subRooms) {
                const intent = appservice.getIntentForUserId(subRoom.polychatUserId);
                await intent.underlyingClient.sendStateEvent(subRoom.roomId, 'm.room.avatar', '', event.content);
            }
        }
    }
});

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

    fillUpSubRoomPool();
}

async function loadExistingRooms() {
    console.info('Called loadExistingRooms');
    console.warn('loadExistingRooms DOES NOT ACTUALLY WORK YET');
    const intents = [
        appservice.getIntent(registration.sender_localpart),
        ...SIGNAL_BRIDGE_ACCOUNT_MXIDS.map(appservice.getIntentForUserId),
        ...TELEGRAM_BRIDGE_ACCOUNT_MXIDS.map(appservice.getIntentForUserId),
        ...WHATSAPP_BRIDGE_ACCOUNT_MXIDS.map(appservice.getIntentForUserId),
    ];
    const allSubRooms: SubRoom[] = [];
    const allPolychats: Polychat[] = [];
    const allControlRooms: ControlRoom[] = [];
    for (const intent of intents) {
        const joinedRooms = await intent.getJoinedRooms();
        console.info(`loadExistingRooms: Found ${joinedRooms.length} joined rooms as ${intent.userId}`);
        for (const roomId of joinedRooms) {
            try {
                const roomState = await intent.underlyingClient.getRoomStateEvent(roomId, PolychatStateEventType.room, '');
                const nameState = await intent.underlyingClient.getRoomStateEvent(roomId, 'm.room.name', '');
                const tombstoneState = await intent.underlyingClient.getRoomStateEvent(roomId, 'm.room.tombstone', '');
                if (tombstoneState.replacement_room) {
                    console.log(`Ignore existing room ${roomId} because it has a tombstone and got replaced by ${tombstoneState.replacement_room}`);
                    continue;
                }
                if (roomState?.content?.type === 'main') {
                    // TODO: Add `ready`
                    const polychat: Polychat = {
                        mainRoomId: roomId,
                        name: nameState.name,
                        subRooms: [],
                    };
                    console.debug('Found an existing Polychat / Main Room', polychat);
                    allPolychats.push(polychat);
                } else if (roomState?.content?.type === 'sub') {
                    // TODO: Add `ready`
                    const subRoom: SubRoom = {
                        network: roomState.network,
                        polychatUserId: intent.userId,
                        roomId,
                    };
                    console.debug('Found an existing Sub Room', subRoom);
                    allSubRooms.push(subRoom);
                } else if (roomState?.content?.type === 'control') {
                    // TODO: Add `ready`
                    const controlRoom: ControlRoom = {
                        network: roomState.network,
                        roomId,
                    };
                    console.debug('Found an existing Control Room', controlRoom);
                    allControlRooms.push(controlRoom);
                }
            } catch (error) {
                console.warn('Failed to load potential Polychat room.');
                console.warn(error);
            }
        }
    }
    // TODO: Link Main Rooms and Sub Rooms

    console.info(`Done loadExistingRooms: Found ${allPolychats.length} main rooms, ${allSubRooms.length} sub rooms and ${allControlRooms.length} control rooms`);
}

async function main() {
    const intent = appservice.getIntent(registration.sender_localpart);
    await intent.ensureRegistered();
    
    // AppService
    // Typically appservices will want to autojoin all rooms
    AutojoinRoomsMixin.setupOnAppservice(appservice);
    appservice.begin().then(async () => {
        console.log(`AppService: Listening on ${APPSERVICE_BIND_ADDRESS}:${APPSERVICE_PORT}`);
        await loadExistingRooms();
        api.set('ready', true);
        api.set('live', true);
    });
    
    // API
    const apiServer = api.listen(API_PORT, API_BIND_ADDRESS, () => {
        console.info(`API: Listening on ${API_BIND_ADDRESS}:${API_PORT}`);
    });

    process.once('SIGTERM', () => {
        console.error('Got SIGTERM');
        try {
            appservice.stop();
            console.log('AppService: HTTP server closed');
            apiServer.close(() => {
                console.log('API: HTTP server closed');
                process.exit(0);
            });
        } catch (error) {
            console.error("Failed to shut down");
            console.error(error);
            process.exit(1);
        }
    });
}

main();
