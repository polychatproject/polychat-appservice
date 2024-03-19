import { Router } from 'express';
import { allPolychats, findMainRoom, shutDownPolychat, unclaimedSubRooms } from '..';
import { logger } from '../logger';

const log = logger.child({ name: 'api/2024-01-debug' });
const router = Router();

router.get('/all', async (req, res) => {
    res.json({
        polychats: allPolychats(),
        unclaimedSubRooms: [...unclaimedSubRooms.entries()],
    });
});

router.get('/polychats', async (req, res) => {
    res.json({
        polychats: allPolychats(),
    });
});

router.get('/shut-down-polychat/:polychatId', async (req, res) => {
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