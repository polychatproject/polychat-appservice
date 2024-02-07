import React, { useEffect, useState } from 'react';
import { QRCodeToStringOptions, toString } from 'qrcode';

export function QrCode(props: { str: string }) {
    const [dataUrl, setDataUrl] = useState<string | null>(null);

    useEffect(() => {
        let ignore = false;

        const opts: QRCodeToStringOptions = {
            errorCorrectionLevel: 'M',
            margin: 0,
        };

        // toDataURL(props.str, opts, function (err, url) {
        //     if (err) throw err;
        //     if (ignore) return;
        //     setDataUrl(url);
        // });

        toString(props.str, opts).then((url) => {
            if (ignore) return;
            setDataUrl(`data:image/svg+xml;base64,${btoa(url)}`);
        });

        return () => {
            ignore = true;
        }
    }, [props.str]);

    return (
        <div style={{ textAlign: 'center' }}>
            <img
                style={{
                    width: '100%',
                    height: '100%',
                    maxWidth: '400px',
                    maxHeight: '400px',
                }}
                src={dataUrl ?? undefined}
                alt=""
            />
        </div>
    );
}
