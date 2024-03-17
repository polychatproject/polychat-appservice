import fsPromises from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { logger } from './logger';
import {
    allPolychats,
    claimSubRoom,
    createPolychat,
    shutDownPolychat,
    findMainRoom,
    getEnabledNetworks,
    unclaimedSubRooms,
} from '.';
import { PATH_DATA } from './env';

const log = logger.child({ name: 'api' });

const PATH_UPLOADS = process.env.PATH_UPLOADS || path.join(PATH_DATA, './uploads');
const API_JOIN_BASE_URL = process.env.API_JOIN_BASE_URL || 'https://join.polychat.de';

const upload = multer({ dest: PATH_UPLOADS });

const api = express();

// Security:
// https://expressjs.com/en/advanced/best-practice-security.html#at-a-minimum-disable-x-powered-by-header
api.disable('x-powered-by');

const allowCrossDomain = function (req: any, res: any, next: any) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Credentials', true);
    res.header('Access-Control-Allow-Methods', 'POST');
    res.header("Access-Control-Allow-Headers", 'Origin, X-Requested-With, Content-Type, Accept');
    next();
};

// api.use('/api/', express.static(PATH_UPLOADS));

api.use('/api/2024-01', allowCrossDomain);

/**
 * Create a new Polychat.
 */
api.get('/api/2024-01/settings', async (req, res) => {
    res.json({
        networks: getEnabledNetworks(),
    });
});

/**
 * Create a new Polychat.
 */
api.post('/api/2024-01/polychat', upload.single('avatar'), async (req, res) => {
    if (typeof req.body.name !== 'string') {
        res.status(403).json({
            errcode: 'E_NAME_MISSING',
        });
        return;
    }
    const roomName = req.body.name as string;
    try {
        const polychat = await createPolychat({
            name: roomName,
        });
        log.info(`API: Created Polychat ${polychat.mainRoomId}`);
        res.json({
            id: polychat.mainRoomId,
            adminUrl: `${API_JOIN_BASE_URL}/${polychat.mainRoomId}?admin=true`,
            joinUrl: `${API_JOIN_BASE_URL}/${polychat.mainRoomId}`,
            name: polychat.name,
        });
    } catch (err) {
        log.error({
            err,
            requested_room_name: roomName,
        }, 'Failed to create Polychat');
        res.status(500).json({
            errcode: 'E_INTERNAL_ERROR',
        });
    }
});

/**
 * Get the info of a polychat.
 */
api.get('/api/2024-01/polychat/:polychatId', (req, res) => {
    const polychat = findMainRoom(req.params.polychatId.normalize());
    log.info(`API: Requested Polychat ${req.params.polychatId}`);
    if (!polychat) {
        res.status(403).json({
            errcode: 'E_POLYCHAT_NOT_FOUND',
        });
        return;
    }
    res.json({
        id: polychat.mainRoomId,
        adminUrl: `${API_JOIN_BASE_URL}/${polychat.mainRoomId}?admin=true`,
        joinUrl: `${API_JOIN_BASE_URL}/${polychat.mainRoomId}`,
        name: polychat.name,
    });
});

/**
 * Get an invite link for a bridged polychat.
 */
api.post('/api/2024-01/polychat/:polychatId/:networkId', upload.single('avatar'), async (req, res) => {
    const mainRoomId = req.params.polychatId ?? '';
    const networkId = req.params.networkId ?? '';

    // Validate params
    if (!getEnabledNetworks().includes(networkId)) {
        res.status(404).json({ errcode: 'E_UNSUPPORTED_NETWORK', mainRoomId, networkId });
        return;
    }
    // Validate query
    if (req.query.action !== 'join') {
        res.status(403).json({ errcode: 'E_UNSUPPORTED_ACTION' });
        return;
    }

    const identity = req.body.identity;
    const name = req.body.name;
    const avatar = req.body.avatar;
    if (!['inherit', 'custom'].includes(identity)) {
        res.status(403).json({ errcode: 'E_UNSUPPORTED_IDENTITY' });
        return;
    }
    if (identity === 'custom' && !name) {
        res.status(403).json({ errcode: 'E_MISSING_NAME' });
        return;
    }

    const polychat = findMainRoom(mainRoomId);
    if (!polychat) {
        res.status(403).json({
            errcode: 'E_POLYCHAT_NOT_FOUND',
        });
        return;
    }

    try {
        const inviteUrl = await claimSubRoom(polychat, networkId, identity === 'custom' ? name : undefined);
        res.json({
            url: inviteUrl,
        });
    } catch (err) {
        log.warn({ err }, `API: Error claiming a sub room for ${polychat.mainRoomId} for ${networkId}`);
        res.status(500).json({
            errcode: 'E_UNKNOWN',
        });
        return;
    }
});

/* START DEBUG API */
api.use('/api/2024-01-debug', allowCrossDomain);

api.get('/api/2024-01-debug/all', async (req, res) => {
    res.json({
        polychats: allPolychats(),
        unclaimedSubRooms: [...unclaimedSubRooms.entries()],
    });
});

api.get('/api/2024-01-debug/polychats', async (req, res) => {
    res.json({
        polychats: allPolychats(),
    });
});

api.get('/api/2024-01-debug/shut-down-polychat/:polychatId', async (req, res) => {
    const polychat = findMainRoom(req.params.polychatId.normalize());
    if (!polychat) {
        res.status(403).json({
            errcode: 'E_POLYCHAT_NOT_FOUND',
        });
        return;
    }
    log.info(`API: Shutting down polychat ${polychat.mainRoomId}`);
    try {
        await shutDownPolychat(polychat);
        res.status(200).json({
            ok: true,
        });
    } catch (err) {
        log.error({ err }, 'Failed to end Polychat.');
        res.status(500).json({
            errcode: 'E_UNKNOWN',
        });
    }
});

/* START METRICS AND KUBERNETES */

api.get('/livez', (req, res) => {
    if (api.get('live')) {
        res.end('OK');
    } else {
        res.status(400).end('NOK');
    }
});

api.get('/readyz', (req, res) => {
    if (api.get('ready')) {
        res.end('OK');
    } else {
        res.status(400).end('NOK');
    }
});

/* START WEBSITE */

api.get('/index.js', async (req, res) => {
    let text = await fsPromises.readFile('./public/index.js', 'utf-8');
    if (API_JOIN_BASE_URL !== 'https://join.polychat.de') {
        text = text.replace(/https:\/\/join\.polychat\.de/g, API_JOIN_BASE_URL);
    }
    res.type('js').end(text);
});

api.use(express.static('./public'));

api.get('/:polychatId', async (req, res) => {
    const html = await fsPromises.readFile('./public/index.html', 'utf-8');
    res.type('html').end(html);
});

export default api;
