import express from 'express';
import multer from 'multer';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from "node:process";
import { PATH_DATA } from '../env';
import { logger } from '../logger';
import { findMainRoom } from '..';
import api202401 from './2024-01';
import api202401debug from './2024-01-debug';

const log = logger.child({ name: 'api' });

const PATH_UPLOADS = process.env.PATH_UPLOADS || path.join(PATH_DATA, './uploads');
const API_JOIN_BASE_URL = process.env.API_JOIN_BASE_URL || 'https://join.polychat.de';

const upload = multer({ dest: PATH_UPLOADS });

const api = express();

// Security:
// https://expressjs.com/en/advanced/best-practice-security.html#at-a-minimum-disable-x-powered-by-header
api.disable('x-powered-by');

const allowCrossDomain = (_req: express.Request, res: express.Response, next: () => void) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'POST');
    res.header("Access-Control-Allow-Headers", 'Origin, X-Requested-With, Content-Type, Accept');
    next();
};

// api.use('/api/', express.static(PATH_UPLOADS));

api.use('/api/2024-01', allowCrossDomain, api202401);
api.use('/api/2024-01-debug', allowCrossDomain, api202401debug);

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
    const polychat = await findMainRoom(req.params.polychatId);
    if (!polychat) {
        res.status(404).end('Not found');
        return;
    }
    let text = await fsPromises.readFile('./public/index.html', 'utf-8');
    text = text.replace('<!--TITLE-->', API_JOIN_BASE_URL);
    text = text.replace('<!--og:title-->', polychat.name);
    text = text.replace('<!--og:description-->', `Join this Polychat with your favourite chat app.`);
    text = text.replace('<!--og:url-->', `${API_JOIN_BASE_URL}/${polychat.mainRoomId}`);
    text = text.replace('<!--og:image-->', `${API_JOIN_BASE_URL}/api/2024-01/${polychat.mainRoomId}/open-graph.jpg`);
    res.type('html').end(text);
});

export default api;
