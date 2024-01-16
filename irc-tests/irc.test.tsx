import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createReadStream, createWriteStream, ReadStream, WriteStream } from 'node:fs';
import * as fsPromise from 'node:fs/promises';
import * as path from 'node:path';

const PATH_II = process.env.PATH_II_SERVER || '/home/jaller94/Git2/polychat/PolyChat-LocalDeployment/mxtest/data/debian-pcc/irc/inspircd';

const DELAY_AFTER_JOIN = 500;
const DELAY_AFTER_MESSAGE = 500;

function write(stream: WriteStream, data: string): Promise<void> {
    return new Promise(res => {
        if (!stream.write(data)) {
            stream.once('drain', res);
        } else {
            process.nextTick(res);
        }
    });
}

function timeout(ms: number): Promise<void> {
    return new Promise(res => setTimeout(res, ms));
}
async function hasReceivedMessage(channel: string, message: string): Promise<boolean> {
    const data = await fsPromise.readFile(path.join(PATH_II, channel, 'out'), 'utf8');
    // console.log(message, data);
    return data.split('\n').some(line => line.endsWith(message));
}

describe('same channel (no bridge)', () => {
    const channelName = '#foo';
    let inGlobal: WriteStream;
    let inFoo: WriteStream;

    afterAll(() => {
        inGlobal?.close();
        inFoo?.close();
    });

    test('send a room message and receive it', async (done) => {
        inGlobal = createWriteStream(path.join(PATH_II, 'in'));
        await write(inGlobal, `/j ${channelName}\n`);
        await timeout(DELAY_AFTER_JOIN);
        const msg = `Test message ${Math.random()}`;
        inFoo = createWriteStream(path.join(PATH_II, channelName, 'in'), {
            flags: 'r+',
        });
        inFoo.on('error', done);

        await write(inFoo, `${msg}\n`);

        await timeout(DELAY_AFTER_MESSAGE);
        expect(await hasReceivedMessage(channelName, msg)).toBeTrue();
        done();
    });
});

describe('polychat hardcoded football bridge', () => {
    const channelUserA = '#football-usera';
    const channelUserB = '#football-userb';

    let inGlobal: WriteStream;
    let inFoo: WriteStream;

    beforeAll(async (done) => {
        inGlobal = createWriteStream(path.join(PATH_II, 'in'));
        await write(inGlobal, `/j ${channelUserA}\n`);
        await write(inGlobal, `/j ${channelUserB}\n`);
        await timeout(DELAY_AFTER_JOIN);
        inFoo = createWriteStream(path.join(PATH_II, channelUserA, 'in'), {
            flags: 'r+',
        });
        inGlobal.on('error', done);
        inFoo.on('error', done);
        done();
    });

    afterAll(() => {
        inGlobal?.close();
        inFoo?.close();
    });

    test('send a room message and receive it', async (done) => {
        const msg = `Test message ${Math.random()}`;
        await write(inFoo, `${msg}\n`);

        await timeout(DELAY_AFTER_MESSAGE);
        expect(await hasReceivedMessage(channelUserB, msg)).toBeTrue();
        done();
    });

    test('reply to !members, but does not bridge message', async (done) => {
        await write(inFoo, '!members\n');

        await timeout(DELAY_AFTER_MESSAGE);
        expect(await hasReceivedMessage(channelUserA, 'Members:')).toBeTrue();
        expect(await hasReceivedMessage(channelUserB, '!members')).toBeFalse();
        done();
    });
});
