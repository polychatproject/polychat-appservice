import React from 'react';
import {
    Button,
    ThemeProvider,
    Typography,
} from '@mui/material';
import { PolychatHeader } from '../components/PolychatHeader';
import { networks } from '../networks';
import { usePolychatData } from '../hooks/usePolychatData';
import { useServerSettings } from '../hooks/useServerSettings';

type ChooseMessengerProps = {
    polychatId: string,
    isAdmin: boolean,
};

export function ChooseMessenger({ polychatId, isAdmin }: ChooseMessengerProps) {
    const [loading, error, polychatData] = usePolychatData(polychatId);
    const [areSettingsLoading, settingsError, serverSettings] = useServerSettings();

    if (error) return <p>{error}</p>;
    if (!polychatData) return <p>Loading…</p>;

    return (
        <>
            <PolychatHeader
                imageUrl={polychatData.avatar}
                name={polychatData.name}
            />
            
            <Typography variant="h6" component="h3">
                Choose your messenger
            </Typography>
            <Typography>
                You can join a Polychat with the messenger of your choice, you don&apos;t have to install or learn a new app.
            </Typography>

            {areSettingsLoading && (
                <p>Loading available chat apps…</p>
            )}

            {settingsError && (
                <>
                    <p>Failed loading the available chat apps.</p>
                    <p>${settingsError}</p>
                    <p>Reloading the page might help.</p>
                </>
            )}

            {!areSettingsLoading && !settingsError && serverSettings && (
                <div style={{ textAlign: 'center' }}>
                    <ul
                        style={{
                            listStyle: 'none',
                            padding: 0,
                        }}
                    >
                        {serverSettings.networks.map(networkId => {
                            const data = networks[networkId];
                            if (!data) {
                                return;
                            }
                            return (
                                <li key={networkId}>
                                    <ThemeProvider theme={data.theme}>
                                        <Button
                                            href={`#joinIdentity/${polychatId}/${networkId}`}
                                            startIcon={<data.icon />}
                                            variant="outlined"
                                            sx={{
                                                marginBottom: "1em"
                                            }}
                                        >{data.name}</Button>
                                    </ThemeProvider>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            <div style={{ height: '24px' }} />
        </>
    );
}
