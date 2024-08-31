import React from 'react';
import { Typography } from '@mui/material';

export function VersionInfo() {
    return (
        <Typography variant="caption">
            Version {Bun.env.VERSION_NAME} ({Bun.env.VERSION_HASH})
        </Typography>
    );
}
