import React from 'react';
import { expect, test } from 'bun:test';
import {render, screen} from '@testing-library/react';
import { ShareButton } from './ShareButton';

test('renders a button', () => {
    const { unmount } = render(<ShareButton url="http://localhost/test" />);
    expect(screen.getByRole('button')).toBeTruthy();
    unmount();
})
