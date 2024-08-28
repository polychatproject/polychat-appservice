import React, { ChangeEvent, ChangeEventHandler, FormEvent, MouseEventHandler, useCallback, useEffect, useState } from 'react';
import {
    Avatar,
    Button,
    ListItem,
    ListItemAvatar,
    TextField,
} from '@mui/material';
import { FileUpload } from '@mui/icons-material';

const limits = {
    minLength: 3,
    maxLength: 26,
    pattern: /^[a-z-]*$/,
};

function getHelperText(fetchingAvailability: boolean, address: string, addressAvailable: boolean): [boolean, boolean, string] {
    if (fetchingAvailability) {
        return [false, false, 'Checking availibility…'];
    }
    if (address.length < limits.minLength) {
        return [true, false, 'This address is too short.'];
    }
    if (address.length > limits.maxLength) {
        return [true, false, 'This address is too long.'];
    }
    if (!limits.pattern.test(address)) {
        return [true, false, 'Please only use lower case and dashes.']
    }
    if (addressAvailable === false) {
        return [false, false, 'This address is taken.'];
    }
    return [false, true, 'This address is available.'];
}

export function CreatePolychat(props: { }) {
    const [actualReadableUrl, setActualReadableUrl] = useState<string | null>(null);
    const [file, setFile] = useState<File>();
    const [isAvailable, setIsAvailable] = useState<boolean>(false);
    const [isFetching, setIsFetching] = useState<boolean>(false);
    const [groupName, setGroupName] = useState('');
    const [readableAddress, setReadableAddress] = useState('');

    const helperText = getHelperText(isFetching, readableAddress, isAvailable);
    
    useEffect(() => {
        setIsAvailable(false);
        setActualReadableUrl(null);
        if (!readableAddress) return;
        setIsFetching(true);
        let ignore = false;

        (async () => {
            // FIXME: Make API request
            await new Promise(res => setTimeout(res, Math.random() * 1500));
            if (ignore) return;
            setIsFetching(false);
            // FIXME: Use network response
            setIsAvailable(readableAddress !== 'yoga');
            setActualReadableUrl(`https://polychat.de/join/${readableAddress}`);
        })();
        return () => {
            ignore = true;
        };
    }, [readableAddress]);

    const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
        if (!event.target.files) return;
        setFile(event.target.files[0]);
    }, []);

    const handleSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const formData = new FormData();
        formData.append('name', groupName);
        formData.append('addressLocalpart', readableAddress);
        formData.append('avatar', file);

        const res = await fetch(`${Bun.env.POLYCHAT_PROVISIONING_API}/api/2024-01/polychat`, {
            body: formData as BodyInit,
            method: 'post',
        });
        if (!res.ok) {
            //FIXME: Add error state
            return;
        }
        const data = await res.json();
        window.location.href = `#qrpage/${data.id}`;
    }, [groupName, readableAddress, file]);

    const handleReadableAddressChange = useCallback((event) => {
        setReadableAddress(event.target.value);
    }, []);

    const handleFileClick: MouseEventHandler<HTMLInputElement> = useCallback((event) => {
        event.preventDefault();
        alert('Avatar uploads are not implemented yet.');
    }, []);

    const handleGroupNameChange: ChangeEventHandler<HTMLInputElement> = useCallback(event => setGroupName(event.target.value), []);

    return (
        <form onSubmit={handleSubmit}>
            <ListItem>
                {Bun.env.UNSTABLE_FEATURES && <ListItemAvatar>
                    <Avatar>
                        <FileUpload />
                        <input
                            accept="image/png, image/jpeg"
                            type="file"
                            onChange={handleFileChange}
                            onClick={handleFileClick}
                        />
                    </Avatar>
                </ListItemAvatar>}
                <TextField
                    required
                    fullWidth
                    label="Group Name"
                    variant="standard"
                    value={groupName}
                    onChange={handleGroupNameChange}
                />
            </ListItem>

            <div style={{ height: '24px' }} />

            {/* <details>
                <summary
                    style={{
                        background: '#ccc',
                    }}
                >
                    <ListItem color="success">
                        <ListItemText
                            primary="Readable Polychat address (optional)"
                            secondary={actualReadableUrl ?? 'off'}
                            secondaryTypographyProps={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                        />
                    </ListItem>
                </summary>

                <div style={{ height: '24px' }} />

                <Typography>Create a readable address for this chat so that users can find and join the chat, even without an invite link.</Typography>

                <div style={{ height: '24px' }} />

                <TextField
                    color={helperText[0] ? 'error' : (helperText[1] ? 'success' : undefined)}
                    error={helperText[0]}
                    fullWidth
                    helperText={helperText[2]}
                    label="Readable Address"
                    value={readableAddress}
                    onChange={handleReadableAddressChange}
                />
            </details> */}

            <div style={{ height: '24px' }} />

            <Button
                type="submit"
                variant="contained"
                disabled={isFetching}
            >Create Invite</Button>
        </form>
    );
}
