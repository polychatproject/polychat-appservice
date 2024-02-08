import React from 'react';
import {
    Button,
    Container,
    Link,
    Typography,
} from '@mui/material';

export function Splash(props: { }) {
    return (
        <Container>
            <Typography
                component="h1"
                fontFamily="serif"
                fontStyle="italic"
                variant="h3"
            >
                Polychat
            </Typography>

            <div style={{ height: '24px' }} />

            <Typography>You want to create a groupchat but can&apos;t agree on a messenger?</Typography>

            <div style={{ height: '24px' }} />

            <Button
                href="#create"
                variant="outlined"
            >Create a Polychat</Button>

            <div style={{ height: '24px' }} />

            <p>
                <Link href="https://polychat.de">What is Polychat?</Link>
            </p>
        </Container>
    );
}
