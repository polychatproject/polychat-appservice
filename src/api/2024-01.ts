import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import process from "node:process";
import { claimSubRoom, createPolychat, findMainRoom, getEnabledNetworks } from '..';
import { PATH_DATA } from '../env';
import { logger } from '../logger';

const PATH_UPLOADS = process.env.PATH_UPLOADS || path.join(PATH_DATA, './uploads');
const API_JOIN_BASE_URL = process.env.API_JOIN_BASE_URL || 'https://join.polychat.de';

const upload = multer({ dest: PATH_UPLOADS });

const log = logger.child({ name: 'api/2024-01' });
const router = Router();

/**
 * Create a new Polychat.
 */
router.get('/settings', async (req, res) => {
    res.json({
        networks: getEnabledNetworks(),
    });
});

/**
 * Create a new Polychat.
 */
router.post('/polychat', upload.single('avatar'), async (req, res) => {
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
router.get('/polychat/:polychatId', (req, res) => {
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
router.post('/polychat/:polychatId/:networkId', upload.single('avatar'), async (req, res) => {
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

export default router;
