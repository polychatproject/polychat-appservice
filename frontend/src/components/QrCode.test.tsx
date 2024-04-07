import React from 'react';
import { expect, test } from 'bun:test';
import {render, screen} from '@testing-library/react';
import { QrCode } from './QrCode';

test('renders a button', () => {
    const { unmount } = render(<QrCode str="http://localhost/test" />);
    unmount();
})
