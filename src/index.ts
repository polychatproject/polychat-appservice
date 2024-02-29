import appservice, { registration, loadExistingRooms, fillUpSubRoomPool } from './appservice';
import api from './api';
import { logger } from './logger';

const API_BIND_ADDRESS = process.env.API_BIND_ADDRESS || '0.0.0.0';
const API_PORT = typeof process.env.API_PORT === 'string' ? Number.parseInt(process.env.API_PORT) : 9998;

const MATRIX_BRIDGE_ACCOUNT_MXIDS = typeof process.env.MATRIX_BRIDGE_ACCOUNT_MXIDS === 'string' ? process.env.MATRIX_BRIDGE_ACCOUNT_MXIDS.split(',') : [];

const LOAD_EXISTING_ROOMS = process.env.LOAD_EXISTING_ROOMS === 'true';

const log = logger.child({ name: 'index' });

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
    appservice.begin().then(async () => {
        log.info(`AppService: Listening…`);
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
