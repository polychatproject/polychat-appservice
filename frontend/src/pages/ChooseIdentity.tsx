import React, { ChangeEvent, FormEvent, useCallback, useState } from 'react';
import {
    Avatar,
    Button,
    FormControl,
    FormControlLabel,
    ListItem,
    ListItemAvatar,
    Radio,
    RadioGroup,
    TextField,
    Typography,
} from '@mui/material';
import { FileUpload } from '@mui/icons-material';
import { PolychatHeader } from '../components/PolychatHeader';
import { networks } from '../networks';
import { usePolychatData } from '../hooks/usePolychatData';

type ChooseMessengerProps = {
    polychatId: string,
    isAdmin: boolean,
    networkId: string,
};

export function ChooseIdentity({ polychatId, isAdmin, networkId }: ChooseMessengerProps) {
    const [file, setFile] = useState<File>();
    const [identity, setIdentity] = useState('inherit');
    const [name, setName] = useState('');
    const [loading, error, polychatData] = usePolychatData(polychatId);
    const network = networks[networkId];

    const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        setFile(e.target.files[0]);
    }, []);

    const handleSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const formData = new FormData();
        formData.append('identity', identity);
        formData.append('name', name);
        formData.append('avatar', file);

        const res = await fetch(`${Bun.env.POLYCHAT_PROVISIONING_API}/api/2024-01/sub-room`, {
            body: formData as BodyInit,
            method: 'post',
        });
        if (!res.ok) {
            //FIXME: Add error state
            return;
        }
        const data = await res.json();

        if (typeof data !== 'object' || !('url' in data) || typeof data.url !== 'string') {
            //FIXME: Add error state
            return;
        }

        window.location.href = data.url;
    }, [identity, name, file]);


    if (error) return <p>{error}</p>;
    if (!network) return <p>Invalid messenger. Please pick a different one.</p>;
    if (!polychatData) return <p>Loading…</p>;

    return (
        <>
            <PolychatHeader
                imageUrl={polychatData.avatar}
                name={polychatData.name}
            />
            
            <Typography variant="h6" component="h3">
                Choose your name and picture
            </Typography>
            <Typography>
                Polychat lets you freely choose your name in every chat. It doesn&apos;t have to be the one you normally use in your messenger.
            </Typography>

            <div style={{ height: '24px' }} />

            <form
                onSubmit={handleSubmit}
            >
                <FormControl>
                    <RadioGroup
                        value={identity}
                        name="identity"
                        onChange={event => setIdentity(event.target.value)}
                    >
                        <FormControlLabel value="inherit" control={<Radio />} label={`Use name and picture from my ${network.name} profile`} />
                        <FormControlLabel value="custom" control={<Radio />} label="Set name and picture specifically for this chat" />
                    </RadioGroup>
                </FormControl>

                {identity === 'custom' && (
                    <ListItem disablePadding>
                        <ListItemAvatar>
                            <Avatar>
                                <FileUpload />
                                <input
                                    accept="image/png, image/jpeg"
                                    type="file"
                                    onChange={handleFileChange}
                                    onClick={event => {
                                        event.preventDefault();
                                        alert('Avatar uploads are not implemented yet.');
                                    }}
                                />
                            </Avatar>
                        </ListItemAvatar>
                        <TextField
                            required
                            fullWidth
                            label="Your name is this room"
                            variant="standard"
                            value={name}
                            onChange={event => setName(event.target.value)}
                        />
                    </ListItem>
                )}

                <div style={{ height: '24px' }} />
                
                <div style={{ textAlign: 'center' }}>
                    <Button
                        startIcon={<network.icon />}
                        type="submit"
                        variant="contained"
                    >
                        Join with {network.name}
                    </Button>
                </div>
            </form>

            <div style={{ height: '24px' }} />
        </>
    );
}
