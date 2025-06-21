// Make the build fail if @matrix-org/matrix-sdk-crypto-nodejs wasn't installed correctly.
// Bun fails to install matrx-bot SDK because of native dependencies.
// That's why we are using "npm install" instead of "bun install".

import {
    MatrixClient,
} from 'matrix-bot-sdk';

const appservice = new MatrixClient('http://localhost', 'b');
