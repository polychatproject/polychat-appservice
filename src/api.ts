import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { createChannel } from '.';

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
        const channel = await createChannel({
            name: req.body.name,
        });
        res.json({
            id: channel.mainRoomId,
        });
    } catch (error) {
        console.warn('Failed to create Polychat');
        console.warn(error);
    }
});

export default api;
