import React, { useCallback, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, IconButton } from '@mui/material';
import { Share } from '@mui/icons-material';

export function ShareButton(props: { url: string }) {
    const [ isModalOpen, setIsModalOpen ] = useState(false);

    const handleShare = useCallback(() => {
        const shareData = {
            title: 'Yoga on Polychat',
            text: 'This link allows you to chat with others using your preferred messenger.',
            url: props.url,
        };
        try {
            if ('canShare' in navigator && navigator.canShare(shareData)) {
                // Web Share API is supported
                navigator.share(shareData).then(() => {
                    console.log('Thanks for sharing!');
                }).catch((error) => {
                    console.error(error);
                    console.warn('Failed to use WebShare API. Opening the modal instead.');
                    setIsModalOpen(true);
                });
            } else {
                setIsModalOpen(true);
            }
        } catch {
            setIsModalOpen(true);
        }
    }, []);

    const handleCloseModal = useCallback(() => {
        setIsModalOpen(false);
    }, []);

    return (
        <>
            {isModalOpen && (
                <Dialog open={isModalOpen} onClose={handleCloseModal}>
                    <DialogTitle>It&apos;s time to invite others!</DialogTitle>
                    <DialogContent>
                        <input readOnly value={props.url} />
                    </DialogContent>
                </Dialog>
            )}
            <IconButton
                size="large"
                edge="end"
                color="inherit"
                aria-label="Share"
                onClick={handleShare}
            >
                <Share />
            </IconButton>
        </>
    );
}
