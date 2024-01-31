import fsPromises from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { allPolychats, claimSubRoom, createPolychat, fillUpSubRoomPool, findMainRoom } from '.';

const PATH_DATA = process.env.PATH_DATA || './data';
const PATH_UPLOADS = process.env.PATH_UPLOADS || path.join(PATH_DATA, './uploads');
const API_JOIN_BASE_URL = process.env.API_JOIN_BASE_URL || 'https://join.polychat.de';

const IRC_BRIDGE_MXID = process.env.IRC_BRIDGE_MXID;
const SIGNAL_BRIDGE_MXID = process.env.SIGNAL_BRIDGE_MXID;
const TELEGRAM_BRIDGE_MXID = process.env.TELEGRAM_BRIDGE_MXID;
const WHATSAPP_BRIDGE_MXID = process.env.WHATSAPP_BRIDGE_MXID;

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
api.use('/api/2024-01-debug', allowCrossDomain);

/**
 * Create a new Polychat.
 */
api.get('/api/2024-01-debug/polychats', async (req, res) => {
    res.json(allPolychats());
});

/**
 * Create a new Polychat.
 */
api.get('/api/2024-01/settings', async (req, res) => {
    const networks: string[] = [];
    if (IRC_BRIDGE_MXID) {
        networks.push('irc');
    }
    if (SIGNAL_BRIDGE_MXID) {
        networks.push('signal');
    }
    if (TELEGRAM_BRIDGE_MXID) {
        networks.push('telegram');
    }
    if (WHATSAPP_BRIDGE_MXID) {
        networks.push('whatsapp');
    }
    res.json({
        networks,
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
    }
    try {
        const polychat = await createPolychat({
            name: req.body.name.normalize(),
        });
        console.log(`API: Created Polychat ${polychat.mainRoomId}`);
        res.json({
            id: polychat.mainRoomId,
            adminUrl: `${API_JOIN_BASE_URL}/${polychat.mainRoomId}?admin=true`,
            joinUrl: `${API_JOIN_BASE_URL}/${polychat.mainRoomId}`,
            name: polychat.name,
        });
    } catch (error) {
        console.warn('Failed to create Polychat');
        console.warn(error);
        res.status(500).json({
            errcode: 'E_INTERNAL_ERROR',
        });
    }
});

/**
 * Get the info of a polychat.
 */
api.get('/api/2024-01/polychat/:polychat', (req, res) => {
    const polychat = findMainRoom(req.params.polychat.normalize());
    console.log(`API: Requested Polychat ${req.params.polychat}`);
    if (!polychat) {
        res.status(403).json({
            errcode: 'E_CHANNEL_NOT_FOUND',
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
 * Claim a sub room
 */
api.get('/api/2024-01/sub-room', async (req, res) => {
    const mainRoomId = req.query.polychat?.toString();
    const network = req.query.network?.toString();
    if (!mainRoomId) {
        res.status(403).json({
            errcode: 'E_MAIN_ROOM_MISSING',
        });
        return;
    }
    if (!network) {
        res.status(403).json({
            errcode: 'E_NETWORK_MISSING',
        });
        return;
    }
    const polychat = findMainRoom(mainRoomId);
    if (!polychat) {
        res.status(403).json({
            errcode: 'E_CHANNEL_NOT_FOUND',
        });
        return;
    }
    try {
        const inviteUrl = await claimSubRoom(polychat, network as any);
        res.json({
            url: inviteUrl,
        });
        fillUpSubRoomPool();
    } catch (error) {
        res.status(500).json({
            errcode: 'E_UNKNOWN',
        });
        return;
    }
});

/**
 * Get an invite link for a bridged polychat.
 */
api.post('/api/2024-01/polychat/:polychat/:network', upload.single('avatar'), async (req, res) => {
    // Validate params
    if (!['telegram', 'whatsapp'].includes(req.params.network)) {
        res.status(404).json({ errcode: 'E_UNSUPPORTED_NETWORK' });
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

    res.json({
        url: 'https://chat.whatsapp.com/BzkM4rkDt1m2CxlgWpkbfl',
    });
    return;
});

api.get('/index.js', async (req, res) => {
    let text = await fsPromises.readFile('./public/index.js', 'utf-8');
    text = text.replace(/https:\/\/join\.polychat\.de/g, API_JOIN_BASE_URL);
    res.type('html').end(text);
});

api.use(express.static('./public'));

api.get('/:polychatId', async (req, res) => {
    const html = await fsPromises.readFile('./public/index.html', 'utf-8');
    res.type('html').end(html);
});

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

export default api;
