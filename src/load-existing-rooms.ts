import { ClaimedSubRoom, ControlRoom, Network, Polychat, PolychatStateEventType, SubRoom, UnclaimedSubRoom } from "./types";
import { isEmptyObject } from "./helper";
import { logger } from './logger';

const log = logger.child({ name: 'appservice' });

export type CategorizedRooms = {
    unclaimedSubRooms: UnclaimedSubRoom[],
    claimedSubRooms: ClaimedSubRoom[],
    polychats: {
        participantStateEvents: Record<string, any>[],
        polychat: Polychat,
    }[],
    controlRooms: ControlRoom[],
}

function stringToNetwork(str: string): Network | undefined {
    if (['irc', 'signal', 'telegram', 'whatsapp'].includes(str)) {
        return str as Network;
    }
    return;
}

export async function categorizeExistingRoom(roomId: string, allStateEvents: any[]): Promise<CategorizedRooms> {
    const result: CategorizedRooms = {
        unclaimedSubRooms: [],
        claimedSubRooms: [],
        polychats: [],
        controlRooms: [],
    };
    const roomState: unknown = allStateEvents.find(e => e.type === PolychatStateEventType.room && e.state_key === '')?.content;
    const nameState = allStateEvents.find(e => e.type === 'm.room.name' && e.state_key === '')?.content;
    const tombstoneState = allStateEvents.find(e => e.type === 'm.room.tombstone' && e.state_key === '')?.content;
    if (typeof roomState !== 'object' || !roomState || isEmptyObject(roomState)) {
        return result;
    }
    if (!('type' in roomState)) {
        log.info({ room_id: roomId }, `Ignoring existing room ${roomId} because it is missing a polychat room type`);
        return result;
    }
    if (tombstoneState?.replacement_room) {
        log.info({ room_id: roomId }, `Ignoring existing room ${roomId} because it has a tombstone and got replaced by ${tombstoneState.replacement_room}`);
        return result;
    }
    if (roomState.type === 'main') {
        const participantStateEvents = allStateEvents.filter(e => e.type === PolychatStateEventType.participant);
        const polychat: Polychat = {
            mainRoomId: roomId,
            name: nameState?.name, // TODO Could be undefined
            subRooms: [],
        };
        log.info({ polychat, room_id: roomId }, 'Found an existing Polychat / Main Room');
        result.polychats.push({
            participantStateEvents,
            polychat,
        });
    } else if (roomState.type === 'sub') {
        if (!('timestamp_ready' in roomState) || typeof roomState.timestamp_ready !== 'number') {
            log.warn({ room_id: roomId, state_content: roomState }, 'Ignoring existing sub room because it is not ready. We should delete the room.');
            return result;
        }
        if (!('invite_url' in roomState) || typeof roomState.invite_url !== 'string') {
            log.warn({ room_id: roomId, state_content: roomState }, 'Ignoring existing sub room because it has no invite_url. We should delete the room.');
            return result;
        }
        if (!('network' in roomState) || typeof roomState.network !== 'string') {
            log.warn({ room_id: roomId, state_content: roomState }, 'Ignoring existing sub room because its network is invalid');
            return result;
        }
        const network = stringToNetwork(roomState.network);
        if (!network) {
            log.warn({ room_id: roomId, state_content: roomState }, 'Ignoring existing sub room because its network is not implemented');
            return result;
        }
        if (!('polychat_user_id' in roomState) || typeof roomState.polychat_user_id !== 'string' || !/^@.+?:.+$/.test(roomState.polychat_user_id)) {
            log.warn({ room_id: roomId, state_content: roomState }, 'Ignoring existing sub room because its polychat_user_id is invalid');
            return result;
        }
        if (!('timestamp_created' in roomState) || typeof roomState.timestamp_created !== 'number') {
            log.warn({ room_id: roomId, state_content: roomState }, 'Ignoring existing sub room because its timestamp_created is invalid');
            return result;
        }
        const subRoom: SubRoom = {
            // TODO: Validate input
            network,
            polychatUserId: roomState.polychat_user_id,
            roomId,
            timestampCreated: new Date(roomState.timestamp_created),
            timestampReady: typeof roomState.timestamp_ready === 'number' ? new Date(roomState.timestamp_ready) : undefined,
            timestampClaimed: typeof roomState.timestamp_claimed === 'number' ? new Date(roomState.timestamp_claimed) : undefined,
            timestampJoined: typeof roomState.timestamp_joined === 'number' ? new Date(roomState.timestamp_joined) : undefined,
            timestampLeft: typeof roomState.timestamp_left === 'number' ? new Date(roomState.timestamp_left) : undefined,
            lastDebugState: 'Loaded existing room after polychat-appservice restart',
            userId: roomState.user_id,
            inviteUrl: roomState.invite_url,
        };
        if ('timestampClaimed' in subRoom && subRoom.timestampClaimed !== undefined) {
            if (!('user' in roomState) || typeof roomState.user !== 'object' || !roomState.user) {
                log.warn({ room_id: roomId, state_content: roomState }, 'Ignoring existing claimed sub room, because its users object is invalid. We should delete the room.');
                return result;
            }
            if (!('identity' in roomState.user) || typeof roomState.user.identity !== 'string') {
                log.warn({ room_id: roomId, state_content: roomState }, 'Ignoring existing sub room because its polychat_user_id is invalid');
                return result;
            }
            if (!('localpart_in_main_room' in roomState.user) || typeof roomState.user.localpart_in_main_room !== 'string') {
                log.warn({ room_id: roomId, state_content: roomState }, 'Ignoring existing sub room because its polychat_user_id is invalid');
                return result;
            }

            if (roomState.user.identity === 'inherit') {
                subRoom.user = {
                    identity: roomState.user.identity,
                    localpartInMainRoom: roomState.user.localpart_in_main_room,
                };
            } else if (roomState.user.identity === 'custom') {
                subRoom.user = {
                    identity: roomState.user.identity,
                    localpartInMainRoom: roomState.user.localpart_in_main_room,
                    displayName: roomState.user.display_name,
                    avatar: roomState.user.avatar,
                };
            } else {
                log.warn({ room_id: roomId, state_content: roomState }, 'Ignoring existing sub room because its user.identity is not implemented');
                return result;
            }
            log.debug({ sub_room: subRoom, room_id: roomId }, 'Found an existing claimed Sub Room');
            result.claimedSubRooms.push(subRoom);
        } else {
            log.debug({ sub_room: subRoom, room_id: roomId }, 'Found an existing unclaimed Sub Room');
            result.unclaimedSubRooms.push(subRoom);
        }
    // } else if (roomState.type === 'control') {
    //     if (!('network' in roomState) || typeof roomState.network !== 'string') {
    //         log.info({ room_id: roomId, state_content: roomState }, 'Ignoring existing sub room because its network is invalid');
    //         return result;
    //     }
    //     const network = stringToNetwork(roomState.network);
    //     if (!network) {
    //         log.info({ room_id: roomId, state_content: roomState }, 'Ignoring existing sub room because its network is not implemented');
    //         return result;
    //     }
    //     const controlRoom: ControlRoom = {
    //         // TODO: Validate input
    //         network,
    //         polychatUserId: roomState.polychat_user_id,
    //         roomId,
    //         timestampCreated: new Date(roomState.timestamp_created),
    //         timestampReady: typeof roomState.timestamp_ready === 'number' ? new Date(roomState.timestamp_ready) : undefined,
    //         timestampClaimed: new Date(roomState.timestamp_claimed),
    //         lastDebugState: 'Loaded existing room after polychat-appservice restart',
    //     };
    //     log.debug({ control_room: controlRoom, room_id: roomId }, 'Found an existing Control Room');
    //     result.controlRooms.push(controlRoom);
    } else {
        log.warn({allStateEvents}, 'Unknown Polychat room type');
    }
    return result;
}
