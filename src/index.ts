import fs from 'node:fs';
import * as path from 'node:path';
import {
    Appservice,
    LogService,
    IAppserviceRegistration,
    SimpleFsStorageProvider,
    SimpleRetryJoinStrategy,
    AutojoinRoomsMixin,
    MatrixClient,
} from 'matrix-bot-sdk';
import { parse as parseYAML } from 'yaml';
import api from './api';
import { LoggerForMatrixBotSdk, logger } from './logger';
import { PATH_CONFIG, PATH_DATA } from './env';
import { uniqueId } from './helper';
import { extractSignalInviteLink, extractTelegramInviteLink, extractWhatsAppInviteLink } from './invite-links';
import { CategorizedRooms, categorizeExistingRoom } from './load-existing-rooms';
import { GenericTransformer } from './transformers/generic';
import { ClaimedSubRoom, Network, Polychat, PolychatStateEventType, SubRoom, SubRoomUser, UnclaimedSubRoom } from './types';

const log = logger.child({ name: 'appservice' });

LogService.setLogger(new LoggerForMatrixBotSdk(logger.child({ name: 'matrix-bot-sdk' })));
// LogService.setLevel(LogLevel.WARN);
LogService.muteModule('Metrics');

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
const MATRIX_BRIDGE_ENABLED = process.env.MATRIX_NETWORK_ENABLED === 'true';
const MATRIX_BRIDGE_ACCOUNT_MXIDS = typeof process.env.MATRIX_BRIDGE_ACCOUNT_MXIDS === 'string' ? process.env.MATRIX_BRIDGE_ACCOUNT_MXIDS.split(',') : [];
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

log.debug('IRC_BRIDGE_MXID', IRC_BRIDGE_MXID);
log.debug('MATRIX_BRIDGE_ENABLED', MATRIX_BRIDGE_ENABLED);
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

const polychats: Polychat[] = [];
export const unclaimedSubRooms: Map<Network, UnclaimedSubRoom[]> = new Map(getEnabledNetworks().map(network => (
    [network, []]
)));

export function getEnabledNetworks(): Network[] {
    const networks: Network[] = [];
    if (IRC_BRIDGE_MXID) {
        networks.push('irc');
    }
    if (MATRIX_BRIDGE_ENABLED) {
        networks.push('matrix');
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

export function popUnclaimedSubRoom(network: Network): UnclaimedSubRoom {
    const unclaimedSubRoomsForThisNetwork = unclaimedSubRooms.get(network);
    if (!Array.isArray(unclaimedSubRoomsForThisNetwork)) {
        throw Error('E_NO_SUB_ROOM_FOR_THIS_NETWORK');
    }
    const subRoomIndex = unclaimedSubRoomsForThisNetwork.findIndex(subRoom => subRoom.timestampReady && subRoom.inviteUrl);
    if (subRoomIndex === -1) {
        throw Error('E_OUT_OF_SUB_ROOMS');
    }
    const [subRoom] = unclaimedSubRoomsForThisNetwork.splice(subRoomIndex, 1);
    if (!subRoom) {
        log.error({ network, sub_room_index: subRoomIndex }, 'Coding error: An unclaimed sub room we had previously selected disappeared.');
        throw Error('E_OUT_OF_SUB_ROOMS');
    }
    return subRoom;
}

/**
 * Take a Sub Room from the pool of prepared Sub Rooms and assign it to one Polychat user and one Polychat.
 */
export async function claimSubRoom(polychat: Polychat, network: Network, userDisplayName?: string): Promise<string> {
    const subRoom = popUnclaimedSubRoom(network);

    const localpartInMainRoom = uniqueId('polychat_');
    const claimedSubRoom: ClaimedSubRoom = {
        ...subRoom,
        timestampClaimed: new Date(),
        user: typeof userDisplayName !== 'string' ? {
            localpartInMainRoom,
            identity: 'inherit',
        } : {
            localpartInMainRoom,
            identity: 'custom',
            displayName: userDisplayName,
            avatar: '',
        },
        lastDebugState: 'Claimed room',
    };
    const intent = appservice.getIntent(registration.sender_localpart);
    const subRoomIntent = appservice.getIntentForUserId(subRoom.polychatUserId);
    const userIntent = appservice.getIntent(localpartInMainRoom);

    await patchSubRoomState(subRoomIntent.underlyingClient, subRoom.roomId, {
        timestamp_claimed: claimedSubRoom.timestampClaimed.getTime(),
        user: claimedSubRoom.user.identity === 'inherit' ? {
            identity: claimedSubRoom.user.identity,
            localpart_in_main_room: claimedSubRoom.user.localpartInMainRoom,
        } : {
            identity: claimedSubRoom.user.identity,
            localpart_in_main_room: claimedSubRoom.user.localpartInMainRoom,
            display_name: claimedSubRoom.user.displayName,
            avatar: claimedSubRoom.user.avatar,
        },
    });

    await userIntent.ensureRegistered();

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

/**
 * Stops bridging a Polychat to a specific sub room. This cannot be undone.
 * Basically the oposite of createSubRoom.
 */
async function shutDownSubRoom(polychat: Polychat, subRoom: SubRoom): Promise<void> {
    polychat.subRooms = polychat.subRooms.filter(s => s !== subRoom);
    const mainRoomIntent = appservice.getIntent(registration.sender_localpart);
    const subRoomIntent = appservice.getIntentForUserId(subRoom.polychatUserId);
    await mainRoomIntent.underlyingClient.sendStateEvent(polychat.mainRoomId, PolychatStateEventType.participant, subRoom.roomId, {});
    // TODO: Unlink bridge, kick bridge bot or whatever needed to stop the link.
    await subRoomIntent.leaveRoom(subRoom.roomId);
}

export async function shutDownPolychat(polychat: Polychat) {
    const index = polychats.findIndex(p => p === polychat);
    if (index === -1) {
        return;
    }
    polychats.splice(index);
    for (const subRoom of polychat.subRooms) {
        await shutDownSubRoom(polychat, subRoom);
    }
    const intent = appservice.getIntent(registration.sender_localpart);
    await intent.underlyingClient.sendNotice(polychat.mainRoomId, 'The administrator ended this Polychat.');
    await intent.leaveRoom(polychat.mainRoomId);
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

const ensureDisplayNameInRoom = async (roomId: string, localpart: string, displayName: string): Promise<void> => {
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
    if (!state || !state.displayname) {
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

    // After the check, we assume the message is from the Polychat user.
    const acceptedUsers = [subRoom.userId];
    if (DEBUG_MXID) {
        acceptedUsers.push(DEBUG_MXID);
    }
    if (!acceptedUsers.includes(event.sender)) {
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
            const network = match.groups!['network'] as Network; // TODO: unsafe type cast
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

    const userIntent = appservice.getIntent(user.localpartInMainRoom);
    // TODO This check should be redundant. Consider replacing it with proper error catching for better performance.
    await userIntent.ensureRegisteredAndJoined(polychat.mainRoomId);
    try {
        const displayName = await getDisplayNameForPolychat(polychat, subRoom, user);
        await ensureDisplayNameInRoom(polychat.mainRoomId, user.localpartInMainRoom, displayName);
    } catch (err) {
        log.error(`Failed to update Display Name of ${user.localpartInMainRoom} in main room ${polychat.mainRoomId}`);
    }
    log.debug({event_content: event.content}, 'onMessageInSubRoom content');

    const cleanedContent = { ...event.content };
    delete cleanedContent['fi.mau.telegram.source'];
    
    await userIntent.sendEvent(polychat.mainRoomId, cleanedContent);
};

const transformer = new GenericTransformer();

/**
 * Patch the de.polychat.room state event of a Sub Room.
 */
const patchSubRoomState = async (client: MatrixClient, roomId: string, patchObject: Record<string, unknown>): Promise<string> => {
    const roomState = await safelyGetRoomStateEvent(client, roomId, PolychatStateEventType.room, '');
    if (!roomState) {
        log.error(`Sub room ${roomId} doesn't seem to have a ${PolychatStateEventType.room} state event.`)
        throw Error(`Failed to fetch sub room state of ${roomId}`);
    }
    return await client.sendStateEvent(roomId, PolychatStateEventType.room, '', {
        ...roomState,
        ...patchObject,
    })
}

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
    const inviteUrl = signalInviteLink ?? telegramInviteLink ?? whatsAppInviteLink;
    const timestampReady = new Date();
    const intent = appservice.getIntentForUserId(subRoom.polychatUserId);
    await patchSubRoomState(intent.underlyingClient, roomId, {
        invite_url: inviteUrl,
        timestamp_ready: timestampReady.getTime(),
    });
    subRoom.inviteUrl = inviteUrl;
    subRoom.timestampReady = timestampReady;
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

export const fillUpSubRoomPool = (): void => {
    log.debug(`Called fillUpSubRoomPool`)
    for (const network of getEnabledNetworks()) {
        const unclaimedSubRoomsForThisNetwork = unclaimedSubRooms.get(network);
        if (unclaimedSubRoomsForThisNetwork === undefined) {
            log.fatal(`Programming error: No array of unclaimed sub rooms for network ${network}`);
            continue;
        }
        const missing = Math.max(SUB_ROOMS_POOL_TARGET - unclaimedSubRoomsForThisNetwork.length, 0);
        log.info(`Sub Room Pool: Creating ${missing} sub rooms for ${network}`);
        for (let i = 0; i < missing; i++) {
            createSubRoom({ network }).catch(err => {
                log.error({
                    err,
                    network,
                }, `Error on creating a new sub room for network ${network}`);
            });
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
    const log2 = log.child({
        function: 'createSubRoom',
        network: opts.network,
    });
    log2.debug('Called createSubRoom');
    if (opts.network === 'irc') {
        if (!IRC_BRIDGE_MXID) {
            throw Error(`Network not configured: ${opts.network}`);
        }
        const ircChannel = uniqueId('polychat_');
        const intent = appservice.getIntent(registration.sender_localpart);
        const roomId = await intent.underlyingClient.createRoom({
            name: opts.name,
            initial_state: [
                {
                    type: PolychatStateEventType.room,
                    content: {
                        type: 'sub',
                        network: opts.network,
                        polychat_user_id: intent.userId,
                        timestamp_created: new Date().getTime(),
                        timestamp_ready: new Date().getTime(),
                        invite_url: `irc://${ircChannel}`,
                    },
                },
            ],
        });
        const log3 = log2.child({ room_id: roomId });
        if (DEBUG_MXID) {
            await intent.underlyingClient.inviteUser(DEBUG_MXID, roomId);
            await intent.underlyingClient.setUserPowerLevel(DEBUG_MXID, roomId, 50);
        }
        await intent.underlyingClient.inviteUser(IRC_BRIDGE_MXID, roomId);

        const dmRoomId = await intent.underlyingClient.dms.getOrCreateDm(IRC_BRIDGE_MXID);
        if (DEBUG_MXID && !(await intent.underlyingClient.getJoinedRoomMembers(dmRoomId)).includes(DEBUG_MXID)) {
            await intent.underlyingClient.inviteUser(DEBUG_MXID, dmRoomId);
        }

        const room: UnclaimedSubRoom = {
            network: opts.network,
            polychatUserId: intent.userId,
            roomId,
            inviteUrl: `irc://${ircChannel}`,
            timestampCreated: new Date(),
            timestampReady: new Date(),
            lastDebugState: 'Room created',
        };
        unclaimedSubRooms.get('irc')!.push(room);

        // TODO: Wait for join, then set up link
        setTimeout(async () => {
            log3.info({ room_id: roomId }, `Send "!plumb" command to ${roomId}`);
            try {
                intent.underlyingClient.sendText(dmRoomId, `!plumb ${roomId} ${IRC_BRIDGE_SERVER} ${ircChannel}`);
                room.lastDebugState = `Sent "!plumb" command and optimistically marked room as ready`;
                log3.info({ room_id: roomId }, `Sent "!plumb" to ${roomId}`);
                room.timestampReady = new Date();
            } catch (err) {
                log3.warn({ err, room_id: roomId }, `Failed to send "!plumb" request to ${roomId}`);
                room.lastDebugState = 'Failed to send "!plumb" command';
            }
        }, 15000);

    } else if (opts.network === 'matrix') {
        if (!MATRIX_BRIDGE_ENABLED) {
            throw Error(`Network not configured: ${opts.network}`);
        }
        if (MATRIX_BRIDGE_ACCOUNT_MXIDS.length === 0) {
            throw Error(`MATRIX_BRIDGE_ACCOUNT_MXIDS required to open WhatsApp sub rooms`);
        }
        const intent = appservice.getIntentForUserId(MATRIX_BRIDGE_ACCOUNT_MXIDS[0]!);
        const roomId = await intent.underlyingClient.createRoom({
            name: opts.name || 'Polychat room',
            // TODO The "matrix" network is just for testing. Otherwise, the visibility should be "private".
            visibility: 'public',
            initial_state: [
                {
                    type: PolychatStateEventType.room,
                    content: {
                        type: 'sub',
                        network: opts.network,
                        polychat_user_id: intent.userId,
                        timestamp_created: new Date().getTime(),
                    },
                },
            ],
        });
        const log3 = log2.child({ room_id: roomId });
        if (DEBUG_MXID) {
            await intent.underlyingClient.inviteUser(DEBUG_MXID, roomId);
            await intent.underlyingClient.setUserPowerLevel(DEBUG_MXID, roomId, 50);
        }

        const room: UnclaimedSubRoom = {
            network: opts.network,
            polychatUserId: intent.userId,
            roomId,
            timestampCreated: new Date(),
            lastDebugState: 'Created room',
        }
        unclaimedSubRooms.get('matrix')!.push(room);

        const inviteUrl = `https://matrix.to/#/${roomId}`;
        const timestampReady = new Date();
        await patchSubRoomState(intent.underlyingClient, roomId, {
            invite_url: inviteUrl,
            timestamp_ready: timestampReady.getTime(),
        });
        room.inviteUrl = inviteUrl;
        room.timestampReady = timestampReady;
        room.lastDebugState = 'Set invite url; room is now ready to be claimed';

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
                        polychat_user_id: intent.userId,
                        timestamp_created: new Date().getTime(),
                    },
                },
            ],
        });
        const log3 = log2.child({ room_id: roomId });
        if (DEBUG_MXID) {
            log3.info(`Invite DEBUG_MXID to ${roomId}`);
            await intent.underlyingClient.inviteUser(DEBUG_MXID, roomId);
            await intent.underlyingClient.setUserPowerLevel(DEBUG_MXID, roomId, 50);
        }
        log3.info(`Invite SIGNAL_BRIDGE_MXID to ${roomId}`);
        await intent.underlyingClient.inviteUser(SIGNAL_BRIDGE_MXID, roomId);
        
        // The Signal bot wants to be able to redact events
        log3.info(`Set power level of SIGNAL_BRIDGE_MXID to 50 in ${roomId}`);
        await intent.underlyingClient.setUserPowerLevel(SIGNAL_BRIDGE_MXID, roomId, 50);
        log3.info(`Join as SIGNAL_BRIDGE_TUG_MXID to ${roomId}`);

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
            log3.info(`Send "create group" command to ${roomId}`);
            try {
                await intent.underlyingClient.sendText(roomId, `${SIGNAL_BRIDGE_COMMAND_PREFIX} create`);
                room.lastDebugState = 'Sent "create group" command';
                log3.info(`Sent "create group" to ${roomId}`);
                // TODO: Wait for success, then get invite link
                setTimeout(async () => {
                    log3.info(`Send "invite-link" to ${roomId}`);
                    try {
                        await intent.underlyingClient.sendText(roomId, `${SIGNAL_BRIDGE_COMMAND_PREFIX} invite-link`);
                        room.lastDebugState = 'Sent "invite-link" command';
                        log3.info(`Sent "invite-link" to ${roomId}`);
                    } catch (err) {
                        log3.warn({ err }, `Failed to send "invite-link" request to ${roomId}`);
                        room.lastDebugState = 'Failed to send "invite-link" command';
                    }
                }, 15000);
            } catch (err) {
                log3.warn({ err }, `Failed to send "create group" request to ${roomId}`);
                room.lastDebugState = 'Failed to send "create group" command';
            }
        }, 15000);

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
                        polychat_user_id: intent.userId,
                        timestamp_created: new Date().getTime(),
                    },
                },
            ],
        });
        const log3 = log2.child({ room_id: roomId });
        if (DEBUG_MXID) {
            log3.info(`Invite DEBUG_MXID to ${roomId}`);
            await intent.underlyingClient.inviteUser(DEBUG_MXID, roomId);
            await intent.underlyingClient.setUserPowerLevel(DEBUG_MXID, roomId, 50);
        }
        log3.info(`Invite TELEGRAM_BRIDGE_MXID to ${roomId}`);
        await intent.underlyingClient.inviteUser(TELEGRAM_BRIDGE_MXID, roomId);
        
        // The Telegram bot wants to be able to redact events
        log3.info(`Set power level of TELEGRAM_BRIDGE_MXID to 50 in ${roomId}`);
        await intent.underlyingClient.setUserPowerLevel(TELEGRAM_BRIDGE_MXID, roomId, 50);
        log3.info(`Invite TELEGRAM_BRIDGE_TUG_MXID to ${roomId}`);
        await intent.underlyingClient.inviteUser(TELEGRAM_BRIDGE_TUG_MXID, roomId);
        const tugIntent = appservice.getIntentForUserId(TELEGRAM_BRIDGE_TUG_MXID);
        log3.info(`Join as TELEGRAM_BRIDGE_TUG_MXID to ${roomId}`);
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
            log3.info(`Send "create group" command to ${roomId}`);
            try {
                await intent.underlyingClient.sendText(roomId, `${TELEGRAM_BRIDGE_COMMAND_PREFIX} create group`);
                room.lastDebugState = 'Sent "create group" command';
                log3.info(`Sent "create group" to ${roomId}`);
                // TODO: Wait for success, then get invite link
                setTimeout(async () => {
                    log3.info(`Send "invite-link" to ${roomId}`);
                    try {
                        await intent.underlyingClient.sendText(roomId, `${TELEGRAM_BRIDGE_COMMAND_PREFIX} invite-link`);
                        room.lastDebugState = 'Sent "invite-link" command';
                        log3.info(`Sent "invite-link" to ${roomId}`);
                    } catch (err) {
                        log3.warn({ err }, `Failed to send "invite-link" request to ${roomId}`);
                        room.lastDebugState = 'Failed to send "invite-link" command';
                    }
                    try {
                        await tugIntent.leaveRoom(roomId);
                        log3.info(`Left ${roomId} as TELEGRAM_BRIDGE_TUG_MXID`);
                    } catch (err) {
                        log3.warn({ err }, `Failed to leave ${roomId} as TELEGRAM_BRIDGE_TUG_MXID`);
                    }
                }, 15000);
            } catch (err) {
                log3.warn({ err }, `Failed to send "create group" request to ${roomId}`);
                room.lastDebugState = 'Failed to send "create group" command';
            }
        }, 15000);

    } else if (opts.network === 'whatsapp') {
        if (!WHATSAPP_BRIDGE_MXID) {
            throw Error(`Network not configured: ${opts.network}`);
        }
        if (WHATSAPP_BRIDGE_ACCOUNT_MXIDS.length === 0) {
            throw Error(`WHATSAPP_BRIDGE_ACCOUNT_MXIDS required to open WhatsApp sub rooms`);
        }
        const intent = appservice.getIntentForUserId(WHATSAPP_BRIDGE_ACCOUNT_MXIDS[0]!);
        const roomId = await intent.underlyingClient.createRoom({
            name: opts.name || '🌸 Polychat room', // Assumption: Like Telegram, WhatsApp requires groups to have a name
            initial_state: [
                {
                    type: 'de.polychat.room',
                    content: {
                        type: 'sub',
                        network: opts.network,
                        polychat_user_id: intent.userId,
                        timestamp_created: new Date().getTime(),
                    },
                },
            ],
        });
        const log3 = log2.child({ room_id: roomId });
        if (DEBUG_MXID) {
            log3.info(`Invite DEBUG_MXID to ${roomId}`);
            await intent.underlyingClient.inviteUser(DEBUG_MXID, roomId);
            await intent.underlyingClient.setUserPowerLevel(DEBUG_MXID, roomId, 50);
        }
        log3.info(`Invite WHATSAPP_BRIDGE_MXID to ${roomId}`);
        await intent.underlyingClient.inviteUser(WHATSAPP_BRIDGE_MXID, roomId);
        
        // The WhatsApp bot wants to be able to redact events
        log3.info(`Set power level of WHATSAPP_BRIDGE_MXID to 50 in ${roomId}`);
        await intent.underlyingClient.setUserPowerLevel(WHATSAPP_BRIDGE_MXID, roomId, 50);
        log3.info(`Join as WHATSAPP_BRIDGE_TUG_MXID to ${roomId}`);

        const room: UnclaimedSubRoom = {
            network: opts.network,
            polychatUserId: intent.userId,
            roomId,
            timestampCreated: new Date(),
            lastDebugState: 'Created room',
        };
        unclaimedSubRooms.get('whatsapp')!.push(room);

        // TODO: Wait for join, then set up link
        setTimeout(async () => {
            try {
                log3.info(`Send "create" command to ${roomId}`);
                await intent.underlyingClient.sendText(roomId, `${WHATSAPP_BRIDGE_COMMAND_PREFIX} create`);
                room.lastDebugState = 'Sent "create" command';
                log3.info(`Sent "create" to ${roomId}`);
                // TODO: Wait for link, then get invite link
                setTimeout(async () => {
                    try {
                        log3.info(`Send "invite-link" to ${roomId}`);
                        await intent.underlyingClient.sendText(roomId, `${WHATSAPP_BRIDGE_COMMAND_PREFIX} invite-link`);
                        room.lastDebugState = 'Sent "invite-link" command';
                        log3.info(`Sent "invite-link" to ${roomId}`);
                    } catch (err) {
                        log3.warn({ err }, `Failed to send "invite-link" request to ${roomId}`);
                        room.lastDebugState = 'Failed to send "invite-link" command';
                    }
                }, 15000);
            } catch (err) {
                log3.warn({ err }, `Failed to send "create" request to ${roomId}`);
                room.lastDebugState = 'Failed to send "create" command';
            }
        }, 15000);

    } else {
        throw Error(`Network not implemented: ${opts.network}`);
    }
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
        const roomName = match.groups!['name']!;
        try {
            const polychat = await createPolychat({ name: roomName });
            await polychatIntent.underlyingClient.replyText(roomId, event.event_id, `created ${polychat.mainRoomId}`);
        } catch (err: any) {
            log.error({
                err,
                requested_room_name: roomName,
                sender: event.sender,
            }, `Failed to create a Polychat in response to a users in-chat request.`);
            await polychatIntent.underlyingClient.replyText(roomId, event.event_id, `error ${err.message}`);
        }
        return;
    }
}

const onMessage = async (roomId: string, event: any): Promise<void> => {
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

    // TODO: Keep a list of Control Rooms instead of implying that every other room is a Control Room.
    return onMessageInControlRoom(roomId, event);

    log.info(`Didn't know what to do with event in ${roomId}`);
};

// Attach listeners here
appservice.on('room.message', async (roomId: string, event: any): Promise<void> => {
    try {
        await onMessage(roomId, event);
    } catch (err) {
        log.fatal({
            err,
            room_id: roomId,
            event,
        }, 'Error on processing incoming room.message');
    }
});

const onEvent = async (roomId: string, event: any): Promise<void> => {
    log.debug({ event, function: 'onEvent' }, 'incoming room.event');

    if (event['type'] === 'm.room.member' && typeof event['state_key'] === 'string') {
        const mxid = event['state_key'];
        // Sub room: Member joined or left
        const subRoomInfo = findActiveSubRoom(roomId);
        if (subRoomInfo) {
            const log2 = log.child({
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
                log2.debug(`Ignoring membership change of system user ${mxid} in sub room ${roomId}`);
                return;
            }
            if (event.content.membership === 'join') {
                if (subRoomInfo.subRoom.userId && mxid !== subRoomInfo.subRoom.userId) {
                    log2.info(`New user ${mxid} in sub room ${roomId}, but the room is already taken by ${subRoomInfo.subRoom.userId}. Kicking the new user...`);
                    const intent = appservice.getIntentForUserId(subRoomInfo.subRoom.polychatUserId);
                    subRoomInfo.subRoom.lastDebugState = 'Another user joined the active room and had to be kicked';
                    try {
                        await intent.underlyingClient.kickUser(mxid, roomId, 'This Polychat sub room is already in use by someone else.');
                    } catch (err) {
                        log2.warn(`Failed to kick ${mxid} from the sub room ${roomId} which belongs to ${subRoomInfo.subRoom.userId}`);
                        subRoomInfo.subRoom.lastDebugState = 'Another user joined the active room but we failed to kick them';
                    }
                    return;
                }
                if (subRoomInfo.subRoom.userId === undefined) {
                    log2.info(`New user ${mxid} in sub room ${roomId}. This sub room now becomes active.`);
                    subRoomInfo.subRoom.userId = mxid;
                    subRoomInfo.subRoom.timestampJoined = new Date();
                    subRoomInfo.subRoom.timestampLeft = undefined;
                    subRoomInfo.subRoom.lastDebugState = 'Polychat user joined. Room is now active.';
                    const intent = appservice.getIntent(registration.sender_localpart);
                    const userIntent = appservice.getIntent(subRoomInfo.subRoom.user.localpartInMainRoom);
                    const subRoomIntent = appservice.getIntentForUserId(subRoomInfo.subRoom.polychatUserId);
                    await patchSubRoomState(subRoomIntent.underlyingClient, roomId, {
                        user_id: subRoomInfo.subRoom.userId,
                        timestamp_joined: subRoomInfo.subRoom.timestampJoined.getTime(),
                        timestamp_left: undefined,
                    });
                    try {
                        await intent.underlyingClient.inviteUser(userIntent.userId, subRoomInfo.polychat.mainRoomId);
                        // TODO This registered check should be redundant. Consider replacing it with proper error catching for better performance.
                        await userIntent.ensureRegisteredAndJoined(subRoomInfo.polychat.mainRoomId);
                    } catch (err) {
                        log2.error({ err }, `Failed to invite & join ${userIntent.userId} for ${mxid} in the main room ${subRoomInfo.polychat.mainRoomId}`);
                    }
                    return;
                }
            } else {
                // We consider every other state a leave
                if (subRoomInfo.subRoom.userId === mxid && subRoomInfo.subRoom.timestampLeft === undefined) {
                    subRoomInfo.subRoom.timestampLeft = new Date();
                    log2.info(`The Polychat user ${mxid} left its sub room ${roomId}.`);
                    const userIntent = appservice.getIntent(subRoomInfo.subRoom.user.localpartInMainRoom);
                    const subRoomIntent = appservice.getIntentForUserId(subRoomInfo.subRoom.polychatUserId);
                    await patchSubRoomState(subRoomIntent.underlyingClient, roomId, {
                        timestamp_left: subRoomInfo.subRoom.timestampLeft.getTime(),
                    });
                    try {
                        // TODO This check should be redundant. Consider replacing it with proper error catching for better performance.
                        await userIntent.ensureRegistered();
                        await userIntent.underlyingClient.leaveRoom(subRoomInfo.polychat.mainRoomId);
                    } catch (err) {
                        log2.error({ err }, `Failed to leave ${userIntent.userId} for ${mxid} in the main room ${subRoomInfo.polychat.mainRoomId}`);
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
};

appservice.on('room.event', async (roomId: string, event: any): Promise<void> => {
    try {
        await onEvent(roomId, event);
    } catch (err) {
        log.fatal({
            err,
            room_id: roomId,
            event,
        }, 'Error on processing incoming room.event');
    }
});

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

/**
 * After polychat-appservice has been restarted, we iterate through joined rooms to restore the bridge.
 */
async function loadExistingRooms(): Promise<void> {
    log.debug('Called loadExistingRooms');
    log.warn('loadExistingRooms DOES NOT PROPERLY WORK YET');
    const intents = [
        appservice.getIntent(registration.sender_localpart),
        ...SIGNAL_BRIDGE_ACCOUNT_MXIDS.map(mxid => appservice.getIntentForUserId(mxid)),
        ...TELEGRAM_BRIDGE_ACCOUNT_MXIDS.map(mxid => appservice.getIntentForUserId(mxid)),
        ...WHATSAPP_BRIDGE_ACCOUNT_MXIDS.map(mxid => appservice.getIntentForUserId(mxid)),
    ];
    log.debug('loadExistingRooms: Set the intents');
    let foundRooms: CategorizedRooms = {
        unclaimedSubRooms: [],
        claimedSubRooms: [],
        polychats: [],
        controlRooms: [],
    };

    log.info('loadExistingRooms: START: Load room state of joined rooms');
    for (const intent of intents) {
        const joinedRooms = await intent.underlyingClient.getJoinedRooms();
        log.info(`loadExistingRooms: Found ${joinedRooms.length} joined rooms as ${intent.userId}`);
        for (const roomId of joinedRooms) {
            try {
                const allStateEvents = await intent.underlyingClient.getRoomState(roomId);
                const newRooms = await categorizeExistingRoom(roomId, allStateEvents);
                foundRooms = {
                    unclaimedSubRooms: [
                        ...foundRooms.unclaimedSubRooms,
                        ...newRooms.unclaimedSubRooms,
                    ],
                    claimedSubRooms: [
                        ...foundRooms.claimedSubRooms,
                        ...newRooms.claimedSubRooms,
                    ],
                    polychats: [
                        ...foundRooms.polychats,
                        ...newRooms.polychats,
                    ],
                    controlRooms: [
                        ...foundRooms.controlRooms,
                        ...newRooms.controlRooms,
                    ],
                };
            } catch (err) {
                log.warn({ err }, 'Failed to load potential Polychat room.');
            }
        }
    }
    log.info(`loadExistingRooms: Found ${foundRooms.polychats.length} main rooms, ${foundRooms.claimedSubRooms.length} claimed sub rooms, ${foundRooms.unclaimedSubRooms.length} unclaimed sub rooms and ${foundRooms.controlRooms.length} control rooms`);
    log.info('loadExistingRooms: END: Load room state of joined rooms');

    // TODO: This shouldn't be needed, but might catch a bug or failed operation.
    log.info(`loadExistingRooms: START: Ensure all localpartInMainRoom are registered`);
    for (const claimedSubRoom of foundRooms.claimedSubRooms) {
        const intent = appservice.getIntent(claimedSubRoom.user.localpartInMainRoom);
        try {
            await intent.ensureRegistered();
        } catch (err) {
            const mxid = intent.userId;
            log.error({ err, mxid }, `loadExistingRooms: Failed to register ${mxid}`);
        }
    }
    log.info(`loadExistingRooms: DONE: Ensure all localpartInMainRoom are registered`);

    log.info(`loadExistingRooms: START: Link polychats and claimed Sub Rooms`);
    for (const {participantStateEvents, polychat} of foundRooms.polychats) {
        try {
            for (const participantStateEvent of participantStateEvents) {
                log.info(`Evaluating if participant ${participantStateEvent.state_key} belongs to polychat ${polychat.mainRoomId}.`);
                if (!participantStateEvent.content.room_id || typeof participantStateEvent.content.room_id !== 'string') {
                    log.info(`Participant ${participantStateEvent.state_key} of polychat ${polychat.mainRoomId} is no longer in use and will be ignored.`);
                    continue;
                }
                const claimedSubRoom = foundRooms.claimedSubRooms.find(subRoom => subRoom.roomId === participantStateEvent.content.room_id);
                if (!claimedSubRoom) {
                    log.error(`Did not find Claimed Sub Room ${participantStateEvent.content.room_id} for participant ${participantStateEvent.state_key} to add them to polychat ${polychat.mainRoomId}.`);
                    continue;
                }
                polychat.subRooms.push(claimedSubRoom);
            }
        } catch (err) {
            log.error({ err, room_id: polychat.mainRoomId }, `There was an unexpected error while loading the sub rooms for Polychat ${polychat.mainRoomId}`);
        }
    }
    log.info(`loadExistingRooms: DONE: Link polychats and claimed Sub Rooms`);

    log.info(`loadExistingRooms: START: Sort unclaimed rooms by network`);
    polychats.push(...foundRooms.polychats.map(({polychat}) => polychat));
    for (const unclaimedSubRoom of foundRooms.unclaimedSubRooms) {
        const array = unclaimedSubRooms.get(unclaimedSubRoom.network);
        if (!Array.isArray(array)) {
            log.error({ room_id: unclaimedSubRoom.roomId, network: unclaimedSubRoom.network }, 'loadExistingRooms: Missing network array to store unclaimed Sub Room. Is this network configured?');
            continue;
        }
        array.push(unclaimedSubRoom);
    }
    log.info(`loadExistingRooms: DONE: Sort unclaimed rooms by network`);

    log.info('loadingExistingRooms: Done');
}

async function main(): Promise<void> {
    const intent = appservice.getIntent(registration.sender_localpart);
    await intent.ensureRegistered();

    // TODO: Temporary solution so I don't have to register these manually
    for (const mxid of MATRIX_BRIDGE_ACCOUNT_MXIDS) {
        const intent = appservice.getIntentForUserId(mxid);
        await intent.ensureRegistered();
    }
    
    if (LOAD_EXISTING_ROOMS) {
        await loadExistingRooms();
    }

    // AppService
    // Typically appservices will want to autojoin all rooms
    AutojoinRoomsMixin.setupOnAppservice(appservice);
    appservice.begin().then(async () => {
        log.info(`AppService: Listening on ${APPSERVICE_BIND_ADDRESS}:${APPSERVICE_PORT}`);
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
