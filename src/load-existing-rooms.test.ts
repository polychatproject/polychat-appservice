import { describe, expect, test } from "bun:test";
import { categorizeExistingRoom } from "./load-existing-rooms";
import { Polychat } from ".";

describe('categorizeExistingRoom', () => {
  const roomId = '!CUroUgyjMhtUZUwhxU:polychat.de';
  const GOOD_MAIN_ROOM = [
    {
      type: 'm.room.name',
      state_key: '',
      sender: '@telegrambot:polychat.de',
      content: {
        name: 'Yoga',
      },
      event_id: '$pCm_iHndKF5V7GmQh0WBccuX39gn7XsOZfRr8BuTa34',
      room_id: roomId,
    },
    {
      type: 'de.polychat.room',
      state_key: '',
      sender: '@telegrambot:polychat.de',
      content: {
        type: 'main',
      },
      event_id: '$pCm_iHndKF5V7GmQh0WBccuX39gn7XsOZfRr8BuTa34',
      room_id: roomId,
    },
  ];
  test('Ignores a room with a tombstone', async () => {
    const events = [
      ...GOOD_MAIN_ROOM,
    ];
    const result = await categorizeExistingRoom(roomId, events);
    expect(result.polychats).toBeArrayOfSize(1);
    const expected: Polychat = {
      name: 'Yoga',
      mainRoomId: roomId,
      subRooms: [],
    };
    expect(result.polychats[0]).toEqual({
      participantStateEvents: [],
      polychat: expected,
    });
});
  test('Ignores a room with a tombstone', async () => {
      const events = [
        ...GOOD_MAIN_ROOM,
        {
          type: 'm.room.tombstone',
          state_key: '',
          sender: '@telegrambot:polychat.de',
          content: {
            body: 'This room has been replaced',
            replacement_room: '!newroom:example.org'
          },
          event_id: '$pCm_iHndKF5V7GmQh0WBccuX39gn7XsOZfRr8BuTa34',
          room_id: roomId,
        },
      ];
      const result = await categorizeExistingRoom(roomId, events);
      expect(result.polychats).toBeArrayOfSize(0);
  });
});