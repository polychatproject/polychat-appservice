export type Network = 'irc' | 'signal' | 'telegram' | 'whatsapp';

export enum PolychatStateEventType {
    room = 'de.polychat.room',
    participant = 'de.polychat.room.participant',
};

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
    /** The MXID of the Polychat Bot */
    polychatUserId: string,
    /** The network ID, e.g. "whatsapp" */
    network: Network,
    /** The Matrix room ID */
    roomId: string,
    /** A URL we can give to the user for them to join the chat */
    inviteUrl?: string,
    /** When was this sub room created? */
    timestampCreated: Date,
    /** When was this sub room ready to be claimed? */
    timestampReady?: Date,
    /** Just for debugging rooms: What was the last status change? */
    lastDebugState: string,
};

export type ControlRoom = UnclaimedSubRoom & {
    /** When was the sub room created? */
    timestampClaimed: Date,
    /** When did the user join the room? */
    timestampJoined?: Date,
    /** When did the  user leave the room? */
    timestampLeft?: Date,
    /** The MXID of the user */
    userId?: string,
};

export type ClaimedSubRoom = UnclaimedSubRoom & {
    /** When was the sub room created? */
    timestampClaimed: Date,
    /** When did the user join the room? */
    timestampJoined?: Date,
    /** When did the user leave the room? */
    timestampLeft?: Date,
    user: SubRoomUser,
    /** The MXID of the user (controlled by a bridge). Only available after they joined. */
    userId?: string,
};

export type SubRoom = UnclaimedSubRoom | ClaimedSubRoom;

export type Polychat = {
    name: string,
    avatar?: string,
    mainRoomId: string,
    subRooms: ClaimedSubRoom[],
};
