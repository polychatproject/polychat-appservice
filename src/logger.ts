import fs from 'node:fs';
import path from 'node:path';
import pino, { Logger } from 'pino';
import { PATH_CONFIG } from './env';
import { ILogger } from 'matrix-bot-sdk';

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

const messageOrObjectToStringOrObject = (module: string, messageOrObject: any[]): Object => {
    if (messageOrObject.every(o => typeof o === 'string' || typeof o === 'number' || typeof o === 'boolean')) {
        return {
            module,
            msg: messageOrObject.join(' ')
        };
    }
    let result = {};
    for (const obj of messageOrObject) {
        result = {
            ...result,
            ...obj,
        }
    }
    return {
        ...result,
        module,
    };
}

export class LoggerForMatrixBotSdk implements ILogger {
    constructor(private logger: Logger<never>) {

    }

    public trace(module: string, ...messageOrObject: any[]) {
        logger.trace(messageOrObjectToStringOrObject(module, messageOrObject));
    }

    public debug(module: string, ...messageOrObject: any[]) {
        logger.debug(messageOrObjectToStringOrObject(module, messageOrObject));
    }

    public error(module: string, ...messageOrObject: any[]) {
        logger.error(messageOrObjectToStringOrObject(module, messageOrObject));
    }

    public info(module: string, ...messageOrObject: any[]) {
        logger.info(messageOrObjectToStringOrObject(module, messageOrObject));
    }

    public warn(module: string, ...messageOrObject: any[]) {
        logger.warn(messageOrObjectToStringOrObject(module, messageOrObject));
    }
}

if (!fileExists) {
    const log = logger.child({name: 'logger'});
    log.info('pino.json does not exist. Use it to configure the logger. See https://getpino.io/#/docs/api?id=options');
}

