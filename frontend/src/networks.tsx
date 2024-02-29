import { Chat, Telegram, WhatsApp } from '@mui/icons-material';
import { Theme, createTheme } from '@mui/material';
import { OverridableComponent } from '@mui/material/OverridableComponent';
import { SvgIconTypeMap } from '@mui/material/SvgIcon/SvgIcon';

export type Network = {
    name: string,
    icon: OverridableComponent<SvgIconTypeMap<{}, "svg">> & { muiName: string; },
    theme: Theme,
};

export const networks: Record<string, Network> = {
    irc: {
        name: 'IRC',
        icon: Chat,
        theme: createTheme({
            palette: {
                primary: {
                    main: '#00f',
                },
            },
        }),
    },
    matrix: {
        name: 'Matrix',
        icon: Chat,
        theme: createTheme({
            palette: {
                primary: {
                    main: '#000',
                },
            },
        }),
    },
    signal: {
        name: 'Signal',
        icon: Chat,
        theme: createTheme({
            palette: {
                primary: {
                    main: '#00f',
                },
            },
        }),
    },
    telegram: {
        name: 'Telegram',
        icon: Telegram,
        theme: createTheme({
            palette: {
                primary: {
                    main: '#00c',
                },
            },
        }),
    },
    whatsapp: {
        name: 'WhatsApp',
        icon: WhatsApp,
        theme: createTheme({
            palette: {
                primary: {
                    main: '#0f0',
                },
            },
        }),
    },
};