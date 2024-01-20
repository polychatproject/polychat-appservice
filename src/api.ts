import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { createPolychat, fillUpSubRoomPool } from '.';

const PATH_DATA = process.env.PATH_DATA || './data';
const PATH_UPLOADS = process.env.PATH_UPLOADS || path.join(PATH_DATA, './uploads');

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

api.use('/avatars', express.static(PATH_UPLOADS));

api.use('/polychat', allowCrossDomain);

/**
 * Create a new Polychat.
 */
api.post('/polychat', upload.single('avatar'), async (req, res) => {
    if (typeof req.body.name !== 'string') {
        res.status(403).json({
            errcode: 'E_NAME_MISSING',
        });
    }
    try {
        const polychat = await createPolychat({
            name: req.body.name,
        });
        fillUpSubRoomPool(polychat);
        res.json({
            id: polychat.mainRoomId,
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
 * Get an invite link for a bridged channel.
 */
api.post('/channel/:channel/:network', upload.single('avatar'), async (req, res) => {
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
