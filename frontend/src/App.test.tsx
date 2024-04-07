import React from 'react';
import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import {http, HttpResponse} from 'msw';
import {setupServer} from 'msw/node';
import {render} from '@testing-library/react';
import { App } from './App';

import {configure} from '@testing-library/react';

configure({reactStrictMode: true});

const server = setupServer(
    http.get('https://join.polychat.de/api/2024-01/settings', () => {
      return HttpResponse.json({greeting: 'hello there'});
    }),
    http.get('https://join.polychat.de/api/2024-01/polychat/lank', () => {
      return HttpResponse.json({greeting: 'hello there'});
    }),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('loads and displays greeting', () => {
    const { unmount } = render(<App />);
    // expect(screen.findAllByTestId('hi')).toMatchSnapshot();
    unmount();
})
