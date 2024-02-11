import { logger } from "./logger";

const log = logger.child({ name: 'invite-links' });

export const extractSignalInviteLink = (event: any, bridgeBotMxid: string): string | undefined => {
    // TODO This has not been tested and is an untested copy of catchTelegramInviteLinks
    if (event.content.msgtype !== 'm.notice') {
        return;
    }
    const body = event.content.body as unknown;
    // TODO Verify that the bridge uses this text to start an invitation link response.
    // This was taken from the Telegram bridge.
    if (typeof body !== 'string' || !body.startsWith('Invite link to ')) {
        return;
    }
    if (event.sender !== bridgeBotMxid) {
        return;
    }
    // Examples:
    // https://signal.group/#CjQKIBLIifvyWswZrG2GalWLYuY_slMXoJkcdcRHWX8tve-iEhAkZV_oH60OaQhcU1TD3mlq
    // const match = body.match(/https:\/\/signal\.group\/#[a-zA-Z0-9_-]+/);
    const match = body.match(/https:\/\/signal\.group\/#\S+$/);
    if (!match) {
        log.warn(`Our regular expression failed to capture this Invite URL: ${body}`);
        return;
    }
    return match[0];
};

export const extractTelegramInviteLink = (event: any, bridgeBotMxid: string): string | undefined => {
    if (event.content.msgtype !== 'm.notice') {
        return;
    }
    const body = event.content.body as unknown;
    if (typeof body !== 'string' || !body.startsWith('Invite link to ')) {
        return;
    }
    if (event.sender !== bridgeBotMxid) {
        return;
    }
    // Examples:
    // https://t.me/+U6Yt2XIwPJxiODNi
    // https://t.me/+w_K5Tl6SPD1kN2Vi
    // const match = body.match(/https:\/\/t\.me\/\+[a-zA-Z0-9_]+/);
    const match = body.match(/https:\/\/t\.me\/\+\S+$/);
    if (!match) {
        log.warn(`Our regular expression failed to capture this Invite URL: ${body}`);
        return;
    }
    return match[0];
};

export const extractWhatsAppInviteLink = (event: any, bridgeBotMxid: string): string | undefined => {
    // TODO This has not been tested and is an untested copy of catchTelegramInviteLinks
    if (event.content.msgtype !== 'm.notice') {
        return;
    }
    const body = event.content.body as unknown;
    // TODO Verify that the bridge uses this text to start an invitation link response.
    // This was taken from the Telegram bridge.
    if (typeof body !== 'string' || !body.startsWith('Invite link to ')) {
        return;
    }
    if (event.sender !== bridgeBotMxid) {
        return;
    }
    // Examples:
    // https://chat.whatsapp.com/BzkM4rkDt1m2CxlgWpkbfl
    // https://chat.whatsapp.com/FJCRPV9PUEDBpFR5L5wIuz
    // const match = body.match(/https:\/\/chat\.whatsapp\.com\/[a-zA-Z0-9]+/);
    const match = body.match(/https:\/\/chat\.whatsapp\.com\/\S+$/);
    if (!match) {
        log.warn(`Our regular expression failed to capture this Invite URL: ${body}`);
        return;
    }
    return match[0];
}
