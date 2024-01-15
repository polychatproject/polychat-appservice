import { afterAll, beforeEach, describe, test } from "bun:test";
import { createReadStream, createWriteStream, ReadStream, WriteStream } from 'node:fs';
import * as fsPromise from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline';
import * as net from 'node:net';

const PATH_II = '/home/jaller94/Git2/polychat/PolyChat-LocalDeployment/mxtest/data/debian-pcc/irc/inspircd';

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

describe('basic ii functionality', () => {
    const channelName = '#foo';
    let inGlobal: WriteStream;
    let inFoo: WriteStream;
    let outFoo: ReadStream;

    afterAll(() => {
        inGlobal?.close();
        inFoo?.close();
        outFoo?.close();
    });

    test('send a room message and receive it', async (done) => {
        inGlobal = createWriteStream(path.join(PATH_II, 'in'));
        await write(inGlobal, `/j ${channelName}\n`);
        await timeout(200);
        const msg = `Test message ${Math.random()}`;
        inFoo = createWriteStream(path.join(PATH_II, channelName, 'in'), {
            flags: 'r+',
        });
        outFoo = createReadStream(path.join(PATH_II, channelName, 'out'));
        outFoo.on('data', (chunk) => {
            console.log(chunk.toString());
            for (const line of chunk.toString().split('\n')) {
                if (line.endsWith(msg)) {
                    done();
                }
            }
        });
        inFoo.on('error', done);
        outFoo.on('error', done);

        await write(inFoo, `${msg}\n`);

        setTimeout(() => done('timeout'), 5000);
    });
});

describe('polychat hardcoded bridge', () => {
    const channelUserA = '#football-usera';
    const channelUserB = '#football-userb';

    let inGlobal: WriteStream;
    let inFoo: WriteStream;
    let outFoo: ReadStream;

    afterAll(() => {
        inGlobal?.close();
        inFoo?.close();
        outFoo?.close();
    });

    test('send a room message and receive it', async (done) => {
        inGlobal = createWriteStream(path.join(PATH_II, 'in'));
        await write(inGlobal, `/j ${channelUserA}\n`);
        await write(inGlobal, `/j ${channelUserB}\n`);
        await timeout(200);
        const msg = `Test message jojo ${Math.random()}`;
        inFoo = createWriteStream(path.join(PATH_II, channelUserA, 'in'), {
            flags: 'r+',
        });
        inGlobal.on('error', done);
        inFoo.on('error', done);


        // fs.open(path.join(PATH_II, channelUserB, 'out'), fs.constants.O_RDONLY | fs.constants.O_NONBLOCK, (err, fd) => {
        //     // Handle err
        //     const pipe = new net.Socket({ fd });
        //     // Now `pipe` is a stream that can be used for reading from the FIFO.
        //     pipe.on('connection', () => {
        //         console.log('connect');
        //     });
        //     pipe.on('end', () => {
        //         console.log('end');
        //     });
        //     pipe.on('error', done);
        //     pipe.on('data', (data) => {
        //         for (const line of data.toString().split('\n')) {
        //             if (line.endsWith(msg)) {
        //                 done();
        //             }
        //         }
        //     });
        // });

        // const outFoo = net.connect('file://' + path.join(PATH_II, channelUserB, 'out'), () => {
        //     console.log('connected');
        // });

        // outFoo.on('end', () => {
        //     console.log('end');
        // });
        // outFoo.on('error', done);
        // outFoo.on('data', (chunk) => {
        //     // console.log(chunk.toString());
        //     for (const line of chunk.toString().split('\n')) {
        //         if (line.endsWith(msg)) {
        //             done();
        //         }
        //     }
        // });
        
        // initListeners();

        // const rl = readline.createInterface({
        //     input: outFoo,
        //     crlfDelay: Infinity,
        // });

        // rl.on('line', (line) => {
        //     console.log(`Line from file: ${line}`);
        //     if (line.endsWith(msg)) {
        //         done();
        //     }
        // });

        // for await (const chunk of Bun.file(path.join(PATH_II, channelUserB, 'out'), {
            
        // }).stream()) {
        //     console.log(String.fromCharCode(...chunk));
        // }

        // // const outFoo2 = Bun.file(path.join(PATH_II, channelUserB, 'out')).stream();
        // // outFoo.on('readable', async () => {
        // //     console.log('BUN stream')
        // //     console.log(await Bun.readableStreamToText(outFoo2));
        // // });
        // outFoo.on('error', done);
        // outFoo.on('watch', () => console.log('watch'));
        
        // outFoo.on('close', () => console.log('close'));
        
        // outFoo.on('readable', () => {
        //     console.log('READBALE', outFoo.read(100000).toString());

        // });
        
        await write(inFoo, `${msg}\n`);

        await timeout(500);

        const data = await fsPromise.readFile(path.join(PATH_II, channelUserB, 'out'), 'utf8');
        for (const line of data.split('\n')) {
            if (line.endsWith(msg)) {
                done();
            }
        }
        
        setTimeout(() => done('timeout'), 5000);
    });
});
