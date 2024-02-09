import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { PATH_CONFIG } from './env';

let options;
let fileExists = true;
try {
    const data = fs.readFileSync(path.join(PATH_CONFIG, 'pino.json'), 'utf8');
    options = JSON.parse(data);
} catch (err: any) {
    if (err.code !== 'ENOENT') {
        console.error(err);
        process.exit(1);
    }
    fileExists = false;
}

export const logger = pino(options);

if (!fileExists) {
    const log = logger.child({name: 'logger'});
    log.info('pino.json does not exist. Use it to configure the logger. See https://getpino.io/#/docs/api?id=options');
}

