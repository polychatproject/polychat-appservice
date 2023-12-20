// require('./instrumentation.ts');

import {
    Appservice,
    IAppserviceRegistration,
    SimpleFsStorageProvider,
    SimpleRetryJoinStrategy,
    AutojoinRoomsMixin,
} from "matrix-bot-sdk";

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
    homeserverName: 'localhost',
    homeserverUrl: 'http://localhost:8008',
    registration,
    storage: new SimpleFsStorageProvider("./data/appservice.json"), // or any other IAppserviceStorageProvider
    joinStrategy: new SimpleRetryJoinStrategy(), // just to ensure reliable joins
});


type SubRoomUser = {
    handOut: Date,
} & ({
    identity: 'inherit',
} | {
    identity: 'custom',
    name: string,
    avatar: string,
});

type SubRoom = {
    ready?: Date,
    user?: SubRoomUser,
    url?: string,
}

type Channel = {
    name: string,
    avatar?: string,
    unclaimedSubRooms: SubRoom[],
    claimedSubRooms: SubRoom[],
    activeSubRooms: SubRoom[],
};

const channels: Map<string, Channel> = new Map();

// subroom
// whatsapp_
// Channel_

channels.set('a', {
    name: 'Yoga',
    unclaimedSubRooms: [],
    claimedSubRooms: [],
    activeSubRooms: [],
});

async function handOut(id: string, network: string): Promise<string> {
    const channel = channels.get(id);
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



// Attach listeners here
appservice.on("room.message", async (roomId: string, event: any) => {
    if (!event['content']?.['msgtype']) return;

    const handOutRegExp = /^hand out ([a-z]+?) ([a-z]+?)$/;
    const match = event.content.body.match(handOutRegExp);
    if (match) {
        const intent = appservice.getIntent('polychat');
        try {
            const url = await handOut(match[1], match[2]);
            await intent.sendText(roomId, `here you go ${url}`);
        } catch (error: any) {
            await intent.sendText(roomId, `error ${error.message}`);
        }
        return;
    }
});

// Typically appservices will want to autojoin all rooms
AutojoinRoomsMixin.setupOnAppservice(appservice);

const intent = appservice.getIntent('polychat');
await intent.ensureRegisteredAndJoined('!coGxdGGoRbrsjNRcJg:localhost');

appservice.begin().then(() => {
    console.log('running');
});

// console.log(as.eventNames());
