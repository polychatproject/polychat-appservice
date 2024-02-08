import { describe, expect, test } from "bun:test";
import { extractTelegramInviteLink } from "./invite-links";

describe('extractWhatsAppInviteLink', () => {
    test('finds a link', () => {
        const event = {
            type: "m.room.message",
            sender: "@telegrambot:polychat.de",
            content: {
              msgtype: "m.notice",
              body: "Invite link to morgentau: https://t.me/+4VuqJY6Ug0BkMTky",
              format: "org.matrix.custom.html",
              formatted_body: "<p>Invite link to morgentau: https://t.me/+4VuqJY6Ug0BkMTky</p>\n",
            },
            origin_server_ts: 1705715101300,
            unsigned: {
              age: 367,
            },
            event_id: "$pCm_iHndKF5V7GmQh0WBccuX39gn7XsOZfRr8BuTa34",
            room_id: "!CUroUgyjMhtUZUwhxU:polychat.de",
        };
        expect(extractTelegramInviteLink(event, '@telegrambot:polychat.de')).toBe('https://t.me/+4VuqJY6Ug0BkMTky');
    });

    test('finds a link', () => {
      const event = {
          type: "m.room.message",
          sender: "@telegrambot:polychat.de",
          content: {
            msgtype: "m.notice",
            body: "Hello world!",
            format: "org.matrix.custom.html",
            formatted_body: "<p>Hello world!</p>\n",
          },
          origin_server_ts: 1705715101300,
          unsigned: {
            age: 367,
          },
          event_id: "$pCm_iHndKF5V7GmQh0WBccuX39gn7XsOZfRr8BuTa34",
          room_id: "!CUroUgyjMhtUZUwhxU:polychat.de",
      };
      expect(extractTelegramInviteLink(event, '@telegrambot:polychat.de')).toBeUndefined();
  });
});