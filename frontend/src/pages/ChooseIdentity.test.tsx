import React from 'react';
import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import {http, HttpResponse} from 'msw';
import {setupServer} from 'msw/node';
import {render} from '@testing-library/react';
import { ChooseIdentity } from './ChooseIdentity';

const server = setupServer(
    http.get('https://join.polychat.de/api/2024-01/polychat/test', () => {
      return HttpResponse.json({
        id: 'test',
        adminUrl: `http://localhost/adminUrl`,
        joinUrl: `http://localhost/joinUrl`,
        name: 'Rügen',
      });
    }),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('loads and displays greeting', () => {
    const { unmount } = render(<ChooseIdentity isAdmin={false} polychatId='test' networkId='matrix' />);
    unmount();
})
