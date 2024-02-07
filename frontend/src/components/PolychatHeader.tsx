import React from 'react';
import {
    Avatar,
    Box,
    Divider,
    Typography,
} from '@mui/material';

export function PolychatHeader(props: { imageUrl?: string, name: string }) {
    return (
        <>
            <div style={{ height: '48px' }} />
            <Box
                display="flex"
                alignItems="center"
                flexDirection="column"
            >
                <Avatar
                    alt=""
                    sx={{ width: 196, height: 196 }}
                    src={props.imageUrl}
                >{props.name.slice(0,1)}</Avatar>
                <div style={{ height: '24px' }} />
                <Typography variant="h4" component="h2">
                    {props.name}
                </Typography>
            </Box>
            
            <div style={{ height: '24px' }} />

            <Divider />

            <div style={{ height: '24px' }} />
        </>
    );
}
