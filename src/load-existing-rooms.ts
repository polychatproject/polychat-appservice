import { ClaimedSubRoom, ControlRoom, Polychat, PolychatStateEventType, SubRoom, UnclaimedSubRoom } from "./types";
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

export async function categorizeExistingRoom(roomId: string, allStateEvents: any[]): Promise<CategorizedRooms> {
    const result: CategorizedRooms = {
        unclaimedSubRooms: [],
        claimedSubRooms: [],
        polychats: [],
        controlRooms: [],
    };
    const roomState = allStateEvents.find(e => e.type === PolychatStateEventType.room && e.state_key === '')?.content;
    const nameState = allStateEvents.find(e => e.type === 'm.room.name' && e.state_key === '')?.content;
    const tombstoneState = allStateEvents.find(e => e.type === 'm.room.tombstone' && e.state_key === '')?.content;
    if (!roomState || isEmptyObject(roomState)) {
        return result;
    }
    if (tombstoneState?.replacement_room) {
        log.info({ room_id: roomId }, `Ignore existing room ${roomId} because it has a tombstone and got replaced by ${tombstoneState.replacement_room}`);
        return result;
    }
    if (roomState.type === 'main') {
        const participantStateEvents = allStateEvents.filter(e => e.type === PolychatStateEventType.participant);
        const polychat: Polychat = {
            mainRoomId: roomId,
            name: nameState?.name, // TODO Could be undefined
            subRooms: [],
        };
        log.info({ polychat: polychat, room_id: roomId }, 'Found an existing Polychat / Main Room', polychat);
        result.polychats.push({
            participantStateEvents,
            polychat,
        });
    } else if (roomState.type === 'sub') {
        const subRoom: SubRoom = {
            // TODO: Validate input
            network: roomState.network,
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
            if (roomState.user) {
                subRoom.user = roomState.user.identity === 'inherit' ? {
                    identity: roomState.user.identity,
                    localpartInMainRoom: roomState.user.identity,
                } : {
                    identity: roomState.user.identity,
                    localpartInMainRoom: roomState.user.identity,
                    displayName: roomState.user.display_name,
                    avatar: roomState.user.avatar,
                };
            }
            log.debug({ sub_room: subRoom, room_id: roomId }, 'Found an existing Claimed Sub Room');
            result.claimedSubRooms.push(subRoom);
        } else {
            log.debug({ sub_room: subRoom, room_id: roomId }, 'Found an existing Unclaimed Sub Room');
            result.unclaimedSubRooms.push(subRoom);
        }
    } else if (roomState.type === 'control') {
        const controlRoom: ControlRoom = {
            // TODO: Validate input
            network: roomState.network,
            polychatUserId: roomState.polychat_user_id,
            roomId,
            timestampCreated: new Date(roomState.timestamp_created),
            timestampReady: typeof roomState.timestamp_ready === 'number' ? new Date(roomState.timestamp_ready) : undefined,
            timestampClaimed: new Date(roomState.timestamp_claimed),
            lastDebugState: 'Loaded existing room after polychat-appservice restart',
        };
        log.debug({ control_room: controlRoom, room_id: roomId }, 'Found an existing Control Room');
        result.controlRooms.push(controlRoom);
    } else {
        log.warn({allStateEvents}, 'Unknown Polychat room type');
    }
    return result;
}
