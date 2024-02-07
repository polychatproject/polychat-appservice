import React, { useEffect, useState } from 'react';

import {
    AppBar,
    Container,
    CssBaseline,
    IconButton,
    Toolbar,
    Typography,
} from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import { ThemeProvider, createTheme } from '@mui/material';
import { ShareButton } from './components/ShareButton';
import { CreatePolychat } from './pages/CreatePolychat';
import { ChooseMessenger } from './pages/ChooseMessenger';
import { ChooseIdentity } from './pages/ChooseIdentity';
import { QrPage } from './pages/QrPage';
import { Splash } from './pages/Splash';
import { usePolychatData } from './hooks/usePolychatData';


const theme = createTheme({
    palette: {
        mode: 'light',
        primary: {
            main: '#ff003d',
        },
    },
});

const BackButton = (props: { href: string }) => (
    <IconButton
        size="large"
        edge="start"
        color="inherit"
        aria-label="Back"
        sx={{ mr: 2 }}
        href={props.href}
    >
        <ArrowBack />
    </IconButton>
);

export function App(props: { }) {
    const [pageParts, setPageParts] = useState<string[]>(location.hash.slice(1).split('/'));
    const polychatId = pageParts[1] ?? location.pathname.slice(1);
    const page = (pageParts[0] === '' && polychatId) ? 'joinMessenger' : pageParts[0];
    console.log('polychatId', pageParts[1], location.pathname.slice(1));
    const [loading, error, polychatData] = usePolychatData(polychatId);

    useEffect(() => {
        const handleHashChange = () => {
            setPageParts(location.hash.slice(1).split('/'));
        };

        window.addEventListener('hashchange', handleHashChange);
        return () => {
            window.removeEventListener('hashchange', handleHashChange);
        };
    }, []);

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline/>
            <AppBar
                elevation={0}
                position="static"
                color='secondary'
            >
                <Container maxWidth="sm">
                    <Toolbar disableGutters>
                        {page === 'create' && (
                        <BackButton href='#' />
                        )}
                        {page === 'qrpage' && (
                            <BackButton href='#create' />
                        )}
                        {page === 'joinIdentity' && (
                            <BackButton href={`#joinMessenger/${polychatId}`} />
                        )}
                        <Typography
                            variant="h6"
                            component="div"
                            sx={{
                                flexGrow: 1,
                                overflowX: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {page === 'create' && 'Create Polychat'}
                            {page === 'qrpage' && 'Chat Invitation'}
                            {page === 'joinMessenger' && 'Choose your messenger'}
                            {page === 'joinIdentity' && 'Choose your name'}
                        </Typography>
                        {page === 'qrpage' && polychatData && (
                            <ShareButton url={polychatData.joinUrl} />
                        )}
                    </Toolbar>
                </Container>
            </AppBar>
            <Container maxWidth="sm">
                {page === '' && (
                    <ThemeProvider theme={theme}>
                        <Splash />
                    </ThemeProvider>
                )}
                {page === 'create' && (
                    <CreatePolychat />
                )}
                {page === 'qrpage' && (
                    <QrPage polychatId={polychatId} />
                )}
                {page === 'joinMessenger' && (
                    <ChooseMessenger polychatId={polychatId} isAdmin={false} />
                )}
                {page === 'joinIdentity' && (
                    <ChooseIdentity polychatId={polychatId} networkId={pageParts[2]} isAdmin={false} />
                )}
                {page === 'admin' && (
                    <ChooseMessenger polychatId={polychatId} isAdmin />
                )}
            </Container>
        </ThemeProvider>
    );
}
