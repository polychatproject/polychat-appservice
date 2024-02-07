import React from 'react';
import { QrCode } from '../components/QrCode';
import { Avatar, Button, ListItem, ListItemAvatar, ListItemText, Link } from '@mui/material';
import { usePolychatData } from '../hooks/usePolychatData';

type QrPageProps = {
    polychatId: string;
};

export function QrPage({ polychatId }: QrPageProps) {
    const [loading, error, polychatData] = usePolychatData(polychatId);

    if (error) return <p>{error}</p>;

    if (!polychatData) return <p>Loading…</p>;

    return (
        <>
            <ListItem>
                <ListItemAvatar>
                    <Avatar
                        src={polychatData.avatar}
                    >
                        {polychatData.name.slice(0,1)}
                    </Avatar>
                </ListItemAvatar>
                <ListItemText>{polychatData.name}</ListItemText>
            </ListItem>
            {polychatData.joinUrl &&
                <QrCode str={polychatData.joinUrl} />
            }
            <Link
                overflow="hidden"
                textOverflow="ellipsis"
                whiteSpace="nowrap"
                href={polychatData.joinUrl.replace('https://polychat.de/join/', '#joinMessenger/')}
            >{polychatData.joinUrl}</Link>

            <div style={{ height: '24px' }} />

            <Button
                href={polychatData.adminUrl}
                variant="outlined"
            >Join Polychat as Admin</Button>

            <div style={{ height: '24px' }} />
        </>
    );
}
