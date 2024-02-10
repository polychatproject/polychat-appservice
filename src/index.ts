import fs from 'node:fs';
import * as path from 'node:path';
import {
    Appservice,
    IAppserviceRegistration,
    SimpleFsStorageProvider,
    SimpleRetryJoinStrategy,
    AutojoinRoomsMixin,
    MatrixClient,
} from 'matrix-bot-sdk';
import { parse as parseYAML } from 'yaml';
import { uniqueId } from './helper';
import api from './api';
import { logger } from './logger';
import { GenericTransformer } from './transformers/generic';
import { extractSignalInviteLink, extractTelegramInviteLink, extractWhatsAppInviteLink } from './invite-links';
import { PATH_CONFIG, PATH_DATA } from './env';

const log = logger.child({ name: 'appservice' });

const DEBUG_MXID = process.env.DEBUG_MXID;
const API_BIND_ADDRESS = process.env.API_BIND_ADDRESS || '0.0.0.0';
const API_PORT = typeof process.env.API_PORT === 'string' ? Number.parseInt(process.env.API_PORT) : 9998;
const APPSERVICE_BIND_ADDRESS = process.env.APPSERVICE_BIND_ADDRESS || '0.0.0.0';
const APPSERVICE_PORT = typeof process.env.APPSERVICE_PORT === 'string' ? Number.parseInt(process.env.APPSERVICE_PORT) : 9999;
const HOMESERVER_NAME = process.env.HOMESERVER_NAME || 'localhost';
const HOMESERVER_URL = process.env.HOMESERVER_URL || 'http://localhost:8008';
const LOAD_EXISTING_ROOMS = process.env.LOAD_EXISTING_ROOMS === 'true';
const SUB_ROOMS_POOL_TARGET = typeof process.env.SUB_ROOMS_POOL_TARGET === 'string' ? Number.parseInt(process.env.SUB_ROOMS_POOL_TARGET) : 2;

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

log.debug('IRC_BRIDGE_MXID', IRC_BRIDGE_MXID);
log.debug('SIGNAL_BRIDGE_MXID', SIGNAL_BRIDGE_MXID);
log.debug('TELEGRAM_BRIDGE_MXID', TELEGRAM_BRIDGE_MXID);
log.debug('WHATSAPP_BRIDGE_MXID', WHATSAPP_BRIDGE_MXID);

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
    localpartInMainRoom: string,
} & ({
    identity: 'inherit',
} | {
    identity: 'custom',
    displayName: string,
    avatar: string,
});

export type UnclaimedSubRoom = {
    /**
     * The MXID of the Polychat Bot
     */
    polychatUserId: string,
    /**
     * The network ID, e.g. "whatsapp"
     */
    network: string,
    /**
     * The Matrix room ID
     */
    roomId: string,
    /**
     * A URL we can give to the Polychat user for them to join the chat
     */
    inviteUrl?: string,
    /**
     * When was this sub room created?
     */
    timestampCreated: Date,
    /**
     * When was this sub room ready to be claimed?
     */
    timestampReady?: Date,
    /**
     * Just for debugging rooms: What was the last status change?
     */
    lastDebugState: string,
};

export type ControlRoom = {
    network: string,
    ready?: Date,
    roomId: string,
};

export type ClaimedSubRoom = UnclaimedSubRoom & {
    timestampClaimed: Date,
    timestampJoined?: Date,
    timestampLeft?: Date,
    user: SubRoomUser,
    userId?: string,
};

export type SubRoom = UnclaimedSubRoom | ClaimedSubRoom;

export type Polychat = {
    name: string,
    avatar?: string,
    mainRoomId: string,
    subRooms: ClaimedSubRoom[],
};

const polychats: Polychat[] = [];
export const unclaimedSubRooms: Map<Network, UnclaimedSubRoom[]> = new Map([
    ['irc', []],
    ['signal', []],
    ['telegram', []],
    ['whatsapp', []],
]);

export function getEnabledNetworks(): string[] {
    const networks: string[] = [];
    if (IRC_BRIDGE_MXID) {
        networks.push('irc');
    }
    if (SIGNAL_BRIDGE_MXID) {
        networks.push('signal');
    }
    if (TELEGRAM_BRIDGE_MXID) {
        networks.push('telegram');
    }
    if (WHATSAPP_BRIDGE_MXID) {
        networks.push('whatsapp');
    }
    return networks;
}

export async function claimSubRoom(polychat: Polychat, network: Network, userDisplayName?: string): Promise<string> {
    const unclaimedSubRoomsForThisNetwork = unclaimedSubRooms.get(network);
    if (!Array.isArray(unclaimedSubRoomsForThisNetwork)) {
        throw Error('E_NO_SUB_ROOM_FOR_THIS_NETWORK');
    }
    const subRoomIndex = unclaimedSubRoomsForThisNetwork.findIndex(subRoom => subRoom.timestampReady && subRoom.inviteUrl);
    if (subRoomIndex === -1) {
        throw Error('E_OUT_OF_SUB_ROOMS');
    }
    const subRoom = unclaimedSubRoomsForThisNetwork[subRoomIndex]!;
    unclaimedSubRoomsForThisNetwork.splice(subRoomIndex, 1);
    const claimedSubRoom: ClaimedSubRoom = {
        ...subRoom,
        timestampClaimed: new Date(),
        user: typeof userDisplayName !== 'string' ? {
            localpartInMainRoom: uniqueId('polychat_'),
            identity: 'inherit',
        } : {
            localpartInMainRoom: uniqueId('polychat_'),
            identity: 'custom',
            displayName: userDisplayName,
            avatar: '',
        },
        lastDebugState: 'Claimed room',
    };
    const intent = appservice.getIntent(registration.sender_localpart);
    const userIntent = appservice.getIntent(claimedSubRoom.user.localpartInMainRoom);
    const subRoomIntent = appservice.getIntentForUserId(subRoom.polychatUserId);
    // TODO Rethink what the state key should be. It's not allowed to be an MXID.
    await intent.underlyingClient.sendStateEvent(polychat.mainRoomId, PolychatStateEventType.participant, subRoom.roomId, {
        room_id: subRoom.roomId,
        user_id: userIntent.userId,
    });
    await subRoomIntent.underlyingClient.sendStateEvent(subRoom.roomId, 'm.room.name', '', {
        name: polychat.name,
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
    return polychats.find(polychat => polychat.mainRoomId === roomId);
}

export function allPolychats(): Polychat[] {
    return polychats;
}

const ensureDisplayNameInRoom = async (roomId: string, localpart: string, displayName: string) => {
    const intent = appservice.getIntent(localpart);
    const eventContent = await safelyGetRoomStateEvent(intent.underlyingClient, roomId, 'm.room.member', intent.userId);
    if (!eventContent) {
        log.warn(`Failed to fetch m.room.member state event for ${intent.userId} in ${roomId}`);
        return;
    }
    if (eventContent.displayname !== displayName) {
        await intent.underlyingClient.sendStateEvent(roomId, 'm.room.member', intent.userId, {
            ...eventContent,
            displayname: displayName,
        });
    }
};

const getDisplayNameForPolychat = async (polychat: Polychat, subRoom: SubRoom, user: SubRoomUser): Promise<string> => {
    log.debug({
        polychat: polychat.mainRoomId,
        user_localpart: user.localpartInMainRoom,
    }, 'Called getDisplayNameForPolychat');
    if (user.identity === 'custom') {
        return user.displayName;
    }
    const intent = appservice.getIntentForUserId(subRoom.polychatUserId);
    const state = await safelyGetRoomStateEvent(intent.underlyingClient, subRoom.roomId, 'm.room.member', intent.userId);
    if (!state || !state) {
        log.error({ member_event_content: state }, `Error fetching the displayname of ${intent.userId} in the sub room ${subRoom.roomId}.`);
        return 'Polychat user';
    }
    return state.displayname;
};

const onMessageInClaimedSubRoom = async (subRoom: ClaimedSubRoom, polychat: Polychat, event: any): Promise<void> => {
    log.debug({
        polychat: polychat.mainRoomId,
        event: event.event_id,
    }, 'Called onMessageInClaimedSubRoom');
    const polychatIntent = appservice.getIntentForUserId(subRoom.polychatUserId);
    if (event.sender !== subRoom.userId && (DEBUG_MXID && event.sender === DEBUG_MXID)) {
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
            await polychatIntent.underlyingClient.replyText(subRoom.roomId, event.event_id, `Could not find Polychat. Command: claim <polychat> <network>`);
            return;
        }
        try {
            const network = match.groups!['network'] as Network; // TODO: unsafe case
            const url = await claimSubRoom(polychat, network);
            await polychatIntent.underlyingClient.replyText(subRoom.roomId, event.event_id, `Invite Url: ${url}`);
        } catch (error: any) {
            await polychatIntent.underlyingClient.replyText(subRoom.roomId, event.event_id, `error ${error.message}`);
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
        await polychatIntent.underlyingClient.replyText(subRoom.roomId, event.event_id, text);
        return;
    }

    const user = subRoom.user;
    if (!user) {
        await polychatIntent.underlyingClient.replyText(subRoom.roomId, event.event_id, 'Internal Error: No user identity set. Did you skip a step?');
        return;
    }

    const intent = appservice.getIntent(user.localpartInMainRoom);
    try {
        const displayName = await getDisplayNameForPolychat(polychat, subRoom, user);
        await ensureDisplayNameInRoom(polychat.mainRoomId, user.localpartInMainRoom, displayName);
    } catch (err) {
        log.error(`Failed to update Display Name of ${user.localpartInMainRoom} in main room ${polychat.mainRoomId}`);
    }
    log.debug({event_content: event.content}, 'onMessageInSubRoom content');

    const cleanedContent = { ...event.content };
    delete cleanedContent['fi.mau.telegram.source'];
    
    await intent.sendEvent(polychat.mainRoomId, cleanedContent);
};

const transformer = new GenericTransformer();

const catchInviteLinks = async (roomId: string, event: any): Promise<void> => {
    const signalInviteLink = SIGNAL_BRIDGE_MXID ? extractSignalInviteLink(event, SIGNAL_BRIDGE_MXID) : undefined;
    const telegramInviteLink = TELEGRAM_BRIDGE_MXID ? extractTelegramInviteLink(event, TELEGRAM_BRIDGE_MXID) : undefined;
    const whatsAppInviteLink = WHATSAPP_BRIDGE_MXID ? extractWhatsAppInviteLink(event, WHATSAPP_BRIDGE_MXID) : undefined;
    if (!signalInviteLink &&  !telegramInviteLink && !whatsAppInviteLink) {
        return;
    }
    const subRoomInfo = findAnySubRoom(roomId);
    if (!subRoomInfo) {
        log.warn(`catchInviteLinks: Found an invite link in ${roomId}, but it's not a sub room.`);
        return;
    }
    const { subRoom } = subRoomInfo;
    if (signalInviteLink && subRoom.network !== 'signal') {
        log.warn(`catchInviteLinks: Found an invite link in sub room ${roomId} for signal, but the sub room is for ${subRoom.network}.`);
        return;
    }
    if (telegramInviteLink && subRoom.network !== 'telegram') {
        log.warn(`catchInviteLinks: Found an invite link in sub room ${roomId} for telegram, but the sub room is for ${subRoom.network}.`);
        return;
    }
    if (whatsAppInviteLink && subRoom.network !== 'whatsapp') {
        log.warn(`catchInviteLinks: Found an invite link in sub room ${roomId} for whatsapp, but the sub room is for ${subRoom.network}.`);
        return;
    }
    log.info(`catchInviteLinks: Caught invite link in sub room ${roomId}`);
    subRoom.inviteUrl = signalInviteLink ?? telegramInviteLink ?? whatsAppInviteLink;
    subRoom.timestampReady = new Date();
    subRoom.lastDebugState = 'Caught invite url; room is now ready to be claimed';
};

const onMessageInMainRoom = async (polychat: Polychat, event: any): Promise<void> => {
    const intent = appservice.getIntent(registration.sender_localpart);
    const userProfile = await intent.underlyingClient.getRoomStateEvent(polychat.mainRoomId, 'm.room.member', event.sender);
    // const senderProfile = (await intent.underlyingClient.getRoomStateEvent(polychat.mainRoomId, 'm.room.member', event.sender)).content;
    for (const subRoom of polychat.subRooms) {
        if (subRoom.user && event.sender === appservice.getIntent(subRoom.user.localpartInMainRoom).userId) {
            // Don't send echo
            continue;
        }
        const { content } = await transformer.transformEventForNetwork(polychat, userProfile, event);
        log.debug({ event_content: content}, 'onMessageInMainRoom content');
        const polychatIntent = appservice.getIntentForUserId(subRoom.polychatUserId);
        polychatIntent.sendEvent(subRoom.roomId, content);
    }
};

export const fillUpSubRoomPool = () => {
    log.debug(`Called fillUpSubRoomPool`)
    const networks: Map<Network, string | undefined> = new Map([
        ['irc', IRC_BRIDGE_MXID],
        ['telegram', TELEGRAM_BRIDGE_MXID],
        ['signal', SIGNAL_BRIDGE_MXID],
        ['whatsapp', WHATSAPP_BRIDGE_MXID],
    ]);

    for (const [network, mxid] of networks.entries()) {
        if (!mxid) {
            // Network not configured
            log.debug(`fillUpSubRoomPool: MXID for ${network} not defined`);
            continue;
        }
        const unclaimedSubRoomsForThisNetwork = unclaimedSubRooms.get(network);
        if (unclaimedSubRoomsForThisNetwork === undefined) {
            log.fatal(`Programming error: No array of unclaimed sub rooms for network ${network}`);
            continue;
        }
        const missing = Math.max(SUB_ROOMS_POOL_TARGET - unclaimedSubRoomsForThisNetwork.length, 0);
        log.info(`Sub Room Pool: Creating ${missing} sub rooms for ${network}`);
        for (let i = 0; i < missing; i++) {
            createSubRoom({ network });
        }
    }
};

export const createPolychat = async (opts: {name: string}): Promise<Polychat> => {
    const intent = appservice.getIntent(registration.sender_localpart);

    const mainRoomId = await intent.underlyingClient.createRoom({
        name: opts.name,
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
    log.debug({
        network: opts.network,
    }, 'Called createSubRoom');
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
            roomId,
            inviteUrl: `irc://${ircChannel}`,
            timestampCreated: new Date(),
            timestampReady: new Date(),
            lastDebugState: 'Room created and optimistically marked as ready',
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
            name: opts.name || 'Polychat room', // Assumption: Like Telegram, Signal requires groups to have a name
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
            log.info(`createSubRoom (signal): Invite DEBUG_MXID to ${roomId}`);
            await intent.underlyingClient.inviteUser(DEBUG_MXID, roomId);
            await intent.underlyingClient.setUserPowerLevel(DEBUG_MXID, roomId, 50);
        }
        log.info(`createSubRoom (signal): Invite SIGNAL_BRIDGE_MXID to ${roomId}`);
        await intent.underlyingClient.inviteUser(SIGNAL_BRIDGE_MXID, roomId);
        
        // The Signal bot wants to be able to redact events
        log.info(`createSubRoom (signal): Set power level of SIGNAL_BRIDGE_MXID to 50 in ${roomId}`);
        await intent.underlyingClient.setUserPowerLevel(SIGNAL_BRIDGE_MXID, roomId, 50);
        log.info(`createSubRoom (signal): Join as SIGNAL_BRIDGE_TUG_MXID to ${roomId}`);

        const room: UnclaimedSubRoom = {
            network: opts.network,
            polychatUserId: intent.userId,
            roomId,
            timestampCreated: new Date(),
            lastDebugState: 'Created room',
        }
        unclaimedSubRooms.get('signal')!.push(room);

        // TODO: Wait for join, then set up link
        setTimeout(async () => {
            log.info(`createSubRoom (signal): Send "create group" command to ${roomId}`);
            try {
                await intent.underlyingClient.sendText(roomId, `${SIGNAL_BRIDGE_COMMAND_PREFIX} create`);
                room.lastDebugState = 'Sent "create group" command';
                log.info(`createSubRoom (signal): Sent "create group" to ${roomId}`);
                // TODO: Wait for success, then get invite link
                setTimeout(async () => {
                    log.info(`createSubRoom (signal): Send "invite-link" to ${roomId}`);
                    try {
                        await intent.underlyingClient.sendText(roomId, `${SIGNAL_BRIDGE_COMMAND_PREFIX} invite-link`);
                        room.lastDebugState = 'Sent "invite-link" command';
                        log.info(`createSubRoom (signal): Sent "invite-link" to ${roomId}`);
                    } catch (err) {
                        log.warn({ err }, `createSubRoom (signal): Failed to send "invite-link" request to ${roomId}`);
                        room.lastDebugState = 'Failed to send "invite-link" command';
                    }
                }, 15000);
            } catch (err) {
                log.warn({ err }, `createSubRoom (signal): Failed to send "create group" request to ${roomId}`);
                room.lastDebugState = 'Failed to send "create group" command';
            }
        }, 15000);
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
            name: opts.name || 'Polychat room', // Telegram requires groups to have a name
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
            log.info(`createSubRoom (telegram): Invite DEBUG_MXID to ${roomId}`);
            await intent.underlyingClient.inviteUser(DEBUG_MXID, roomId);
            await intent.underlyingClient.setUserPowerLevel(DEBUG_MXID, roomId, 50);
        }
        log.info(`createSubRoom (telegram): Invite TELEGRAM_BRIDGE_MXID to ${roomId}`);
        await intent.underlyingClient.inviteUser(TELEGRAM_BRIDGE_MXID, roomId);
        
        // The Telegram bot wants to be able to redact events
        log.info(`createSubRoom (telegram): Set power level of TELEGRAM_BRIDGE_MXID to 50 in ${roomId}`);
        await intent.underlyingClient.setUserPowerLevel(TELEGRAM_BRIDGE_MXID, roomId, 50);
        log.info(`createSubRoom (telegram): Invite TELEGRAM_BRIDGE_TUG_MXID to ${roomId}`);
        await intent.underlyingClient.inviteUser(TELEGRAM_BRIDGE_TUG_MXID, roomId);
        const tugIntent = appservice.getIntentForUserId(TELEGRAM_BRIDGE_TUG_MXID);
        log.info(`createSubRoom (telegram): Join as TELEGRAM_BRIDGE_TUG_MXID to ${roomId}`);
        await tugIntent.joinRoom(roomId);

        const room: UnclaimedSubRoom = {
            network: opts.network,
            polychatUserId: intent.userId,
            roomId,
            timestampCreated: new Date(),
            lastDebugState: 'Created room',
        };
        unclaimedSubRooms.get('telegram')!.push(room);

        // TODO: Wait for join, then set up link
        setTimeout(async () => {
            log.info(`createSubRoom (telegram): Send "create group" command to ${roomId}`);
            try {
                await intent.underlyingClient.sendText(roomId, `${TELEGRAM_BRIDGE_COMMAND_PREFIX} create group`);
                room.lastDebugState = 'Sent "create group" command';
                log.info(`createSubRoom (telegram): Sent "create group" to ${roomId}`);
                // TODO: Wait for success, then get invite link
                setTimeout(async () => {
                    log.info(`createSubRoom (telegram): Send "invite-link" to ${roomId}`);
                    try {
                        await intent.underlyingClient.sendText(roomId, `${TELEGRAM_BRIDGE_COMMAND_PREFIX} invite-link`);
                    } catch (err) {
                        log.warn({ err }, `createSubRoom (telegram): Failed to send "invite-link" request to ${roomId}`);
                        room.lastDebugState = 'Failed to send "invite-link" command';
                    }
                    try {
                        await tugIntent.leaveRoom(roomId);
                        log.info(`createSubRoom (telegram): Left ${roomId} as TELEGRAM_BRIDGE_TUG_MXID`);
                    } catch (err) {
                        log.warn({ err }, `createSubRoom (telegram): Failed to leave ${roomId} as TELEGRAM_BRIDGE_TUG_MXID`);
                    }
                }, 15000);
            } catch (err) {
                log.warn({ err }, `createSubRoom (telegram): Failed to send "create group" request to ${roomId}`);
                room.lastDebugState = 'Failed to send "create group" command';
            }
        }, 15000);

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
            name: opts.name || '', // Assumption: Like Telegram, WhatsApp requires groups to have a name
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
            log.info(`createSubRoom (whatsapp): Invite DEBUG_MXID to ${roomId}`);
            await intent.underlyingClient.inviteUser(DEBUG_MXID, roomId);
            await intent.underlyingClient.setUserPowerLevel(DEBUG_MXID, roomId, 50);
        }
        log.info(`createSubRoom (whatsapp): Invite WHATSAPP_BRIDGE_MXID to ${roomId}`);
        await intent.underlyingClient.inviteUser(WHATSAPP_BRIDGE_MXID, roomId);
        
        // The WhatsApp bot wants to be able to redact events
        log.info(`createSubRoom (whatsapp): Set power level of WHATSAPP_BRIDGE_MXID to 50 in ${roomId}`);
        await intent.underlyingClient.setUserPowerLevel(WHATSAPP_BRIDGE_MXID, roomId, 50);
        log.info(`createSubRoom (whatsapp): Join as WHATSAPP_BRIDGE_TUG_MXID to ${roomId}`);
        // TODO: Wait for success, then set up link
        setTimeout(() => {
            log.info(`createSubRoom (whatsapp): Send "create group" command to ${roomId}`);
            intent.underlyingClient.sendText(roomId, `${WHATSAPP_BRIDGE_COMMAND_PREFIX} create`);
            // TODO: Wait for link, then get invite link
            setTimeout(() => {
                log.info(`createSubRoom (whatsapp): Send "invite-link" to ${roomId}`);
                intent.underlyingClient.sendText(roomId, `${WHATSAPP_BRIDGE_COMMAND_PREFIX} invite-link`);
            }, 15000);
        }, 15000);

        unclaimedSubRooms.get('whatsapp')!.push({
            network: opts.network,
            polychatUserId: intent.userId,
            roomId,
            timestampCreated: new Date(),
            lastDebugState: 'Created room',
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
            await polychatIntent.underlyingClient.replyText(roomId, event.event_id, 'body is not defined');
        } catch {}
        return;
    }
    const body = event.content.body as string;
    const match = body.match(handOutRegExp);
    if (match) {
        try {
            const polychat = await createPolychat({ name: match.groups!['name']! });
            await polychatIntent.underlyingClient.replyText(roomId, event.event_id, `created ${polychat.mainRoomId}`);
        } catch (error: any) {
            await polychatIntent.underlyingClient.replyText(roomId, event.event_id, `error ${error.message}`);
        }
        return;
    }
}

// Attach listeners here
appservice.on('room.message', async (roomId: string, event: any) => {
    if (!event['content']?.['msgtype']) return;

    await catchInviteLinks(roomId, event);

    const subRoomInfo = findActiveSubRoom(roomId);
    if (subRoomInfo) {
        return onMessageInClaimedSubRoom(subRoomInfo.subRoom, subRoomInfo.polychat, event);
    }

    const polychat = findMainRoom(roomId);
    if (polychat) {
        return onMessageInMainRoom(polychat, event);
    }

    return onMessageInControlRoom(roomId, event);

    log.info(`Didn't know what to do with event in ${roomId}`);
});

appservice.on('room.event', async (roomId: string, event: any) => {
    log.debug({ event }, 'room.event');

    if (event['type'] === 'm.room.member' && typeof event['state_key'] === 'string') {
        const mxid = event['state_key'];
        // Sub room: Member joined or left
        const subRoomInfo = findActiveSubRoom(roomId);
        if (subRoomInfo) {
            const localLog = log.child({
                polychat: subRoomInfo.polychat.mainRoomId,
                sub_room: roomId,
                user_id: mxid,
                event_id: event.event_id,
            });
            const systemUsers = [
                subRoomInfo.subRoom.polychatUserId,
            ];
            if (subRoomInfo.subRoom.network === 'irc') {
                IRC_BRIDGE_MXID && systemUsers.push(IRC_BRIDGE_MXID);
            }
            if (subRoomInfo.subRoom.network === 'signal') {
                SIGNAL_BRIDGE_MXID && systemUsers.push(SIGNAL_BRIDGE_MXID);
            }
            if (subRoomInfo.subRoom.network === 'telegram') {
                TELEGRAM_BRIDGE_MXID && systemUsers.push(TELEGRAM_BRIDGE_MXID);
                TELEGRAM_BRIDGE_TUG_MXID && systemUsers.push(TELEGRAM_BRIDGE_TUG_MXID);
            }
            if (subRoomInfo.subRoom.network === 'whatsapp') {
                WHATSAPP_BRIDGE_MXID && systemUsers.push(WHATSAPP_BRIDGE_MXID);
            }
            if (DEBUG_MXID) {
                systemUsers.push(DEBUG_MXID);
            }
            if (systemUsers.includes(mxid)) {
                localLog.debug(`Ignoring membership change of system user ${mxid} in sub room ${roomId}`);
                return;
            }
            if (event.content.membership === 'join') {
                if (subRoomInfo.subRoom.userId && mxid !== subRoomInfo.subRoom.userId) {
                    localLog.info(`New user ${mxid} in sub room ${roomId}, but the room is already taken by ${subRoomInfo.subRoom.userId}. Kicking the new user...`);
                    const intent = appservice.getIntentForUserId(subRoomInfo.subRoom.polychatUserId);
                    subRoomInfo.subRoom.lastDebugState = 'Another user joined the active room and had to be kicked';
                    try {
                        await intent.underlyingClient.kickUser(mxid, roomId, 'This Polychat sub room is already in use by someone else.');
                    } catch (err) {
                        localLog.warn(`Failed to kick ${mxid} from the sub room ${roomId} which belongs to ${subRoomInfo.subRoom.userId}`);
                        subRoomInfo.subRoom.lastDebugState = 'Another user joined the active room but we failed to kick them';
                    }
                    return;
                }
                if (subRoomInfo.subRoom.userId === undefined) {
                    localLog.info(`New user ${mxid} in sub room ${roomId}. This sub room now becomes active.`);
                    subRoomInfo.subRoom.userId = mxid;
                    subRoomInfo.subRoom.timestampJoined = new Date();
                    subRoomInfo.subRoom.timestampLeft = undefined;
                    subRoomInfo.subRoom.lastDebugState = 'Polychat user joined. Room is now active.';
                    const intent = appservice.getIntent(registration.sender_localpart);
                    const userIntent = appservice.getIntent(subRoomInfo.subRoom.user.localpartInMainRoom);
                    try {
                        await intent.underlyingClient.inviteUser(userIntent.userId, subRoomInfo.polychat.mainRoomId);
                        await userIntent.underlyingClient.joinRoom(subRoomInfo.polychat.mainRoomId);
                    } catch (err) {
                        localLog.error({ err }, `Failed to invite & join ${userIntent.userId} for ${mxid} in the main room ${subRoomInfo.polychat.mainRoomId}`);
                    }
                    return;
                }
            } else {
                // We consider every other state a leave
                if (subRoomInfo.subRoom.userId === mxid && subRoomInfo.subRoom.timestampLeft === undefined) {
                    subRoomInfo.subRoom.timestampLeft = new Date();
                    localLog.info(`The Polychat user ${mxid} left its sub room ${roomId}.`);
                    const userIntent = appservice.getIntent(subRoomInfo.subRoom.user.localpartInMainRoom);
                    try {
                        await userIntent.underlyingClient.leaveRoom(subRoomInfo.polychat.mainRoomId);
                    } catch (err) {
                        localLog.error({ err }, `Failed to leave ${userIntent.userId} for ${mxid} in the main room ${subRoomInfo.polychat.mainRoomId}`);
                    }
                }
            }
            return;
        }

        // Main room: Member joined or left
        const polychat = findMainRoom(roomId);
        if (polychat) {
            const polychatIntent = appservice.getIntent(registration.sender_localpart);
            if (event.sender === polychatIntent.userId || (DEBUG_MXID && event.sender === DEBUG_MXID)) {
                // Ignore system users
                return;
            }
            let msg = '';
            // TODO: Find display name of user
            if (event.content.membership === 'join') {
                msg = `${mxid} joined.`;
            }
            if (event.content.membership === 'leave') {
                msg = `${mxid} left.`;
            }
            if (event.content.membership === 'ban') {
                msg = `${mxid} got banned.`;
            }
            if (!msg) {
                return;
            }
            log.info(`Main room: membership of ${mxid} changed to ${event.content.membership}`);
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
            log.info(`Main room: name changed ${JSON.stringify(event.content)}`);
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
            log.info(`Main room: avatar changed ${JSON.stringify(event.content)}`);
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

async function safelyGetRoomStateEvent(client: MatrixClient, roomId: string, type: string, stateKey: string): Promise<Record<string, any> | undefined> {
    try {
        return await client.getRoomStateEvent(roomId, type, stateKey);
    } catch (error: any) {
        if (error?.errcode === 'M_NOT_FOUND') {
            return;
        }
        throw error;
    }
}

async function loadExistingRooms() {
    log.info('Called loadExistingRooms');
    log.warn('loadExistingRooms DOES NOT PROPERLY WORK YET');
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
        log.info(`loadExistingRooms: Found ${joinedRooms.length} joined rooms as ${intent.userId}`);
        for (const roomId of joinedRooms) {
            try {
                const roomState = await safelyGetRoomStateEvent(intent.underlyingClient, roomId, PolychatStateEventType.room, '');
                const nameState = await safelyGetRoomStateEvent(intent.underlyingClient, roomId, 'm.room.name', '');
                const tombstoneState = await safelyGetRoomStateEvent(intent.underlyingClient, roomId, 'm.room.tombstone', '');
                if (tombstoneState?.replacement_room) {
                    log.info(`Ignore existing room ${roomId} because it has a tombstone and got replaced by ${tombstoneState.replacement_room}`);
                    continue;
                }
                if (roomState?.content?.type === 'main') {
                    // TODO: Add `ready`
                    const polychat: Polychat = {
                        mainRoomId: roomId,
                        name: nameState?.name, // TODO Could be undefined
                        subRooms: [],
                    };
                    log.debug('Found an existing Polychat / Main Room', polychat);
                    allPolychats.push(polychat);
                } else if (roomState?.content?.type === 'sub') {
                    // TODO: Add `timestampCreated`
                    // TODO: Add `timestampReady`
                    const subRoom: SubRoom = {
                        network: roomState.network,
                        polychatUserId: intent.userId,
                        roomId,
                        timestampCreated: new Date(),
                        lastDebugState: 'Loaded existing room after polychat-appservice restart',
                    };
                    log.debug('Found an existing Sub Room', subRoom);
                    allSubRooms.push(subRoom);
                } else if (roomState?.content?.type === 'control') {
                    // TODO: Add `ready`
                    const controlRoom: ControlRoom = {
                        network: roomState.network,
                        roomId,
                    };
                    log.debug('Found an existing Control Room', controlRoom);
                    allControlRooms.push(controlRoom);
                }
            } catch (err) {
                log.warn({ err }, 'Failed to load potential Polychat room.');
            }
        }
    }
    // TODO: Link Main Rooms and Sub Rooms

    polychats.push(...allPolychats);

    log.info(`Done loadExistingRooms: Found ${allPolychats.length} main rooms, ${allSubRooms.length} sub rooms and ${allControlRooms.length} control rooms`);
}

async function main() {
    const intent = appservice.getIntent(registration.sender_localpart);
    await intent.ensureRegistered();
    
    // AppService
    // Typically appservices will want to autojoin all rooms
    AutojoinRoomsMixin.setupOnAppservice(appservice);
    appservice.begin().then(async () => {
        log.info(`AppService: Listening on ${APPSERVICE_BIND_ADDRESS}:${APPSERVICE_PORT}`);
        if (LOAD_EXISTING_ROOMS) {
            await loadExistingRooms();
        }
        fillUpSubRoomPool();
        api.set('ready', true);
        api.set('live', true);
    });
    
    // API
    const apiServer = api.listen(API_PORT, API_BIND_ADDRESS, () => {
        log.info(`API: Listening on ${API_BIND_ADDRESS}:${API_PORT}`);
    });

    process.once('SIGTERM', () => {
        log.info('Got SIGTERM');
        try {
            appservice.stop();
            log.info('AppService: HTTP server closed');
            apiServer.close(() => {
                log.info('API: HTTP server closed');
                process.exit(0);
            });
        } catch (err) {
            log.error({ err }, 'Failed to shut down');
            process.exit(1);
        }
    });
}

main();
