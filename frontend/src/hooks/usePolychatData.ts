import React, { useEffect, useState } from 'react';

export type PolychatData = {
    avatar?: string,
    adminUrl: string,
    joinUrl: string,
    name: string,
};

/**
 * 
 * @param polychatId 
 * @returns [ isLoading, error, data ]
 */
export function usePolychatData(polychatId: string | undefined = undefined): [boolean, string | undefined, PolychatData | undefined ] {
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | undefined>();
    const [data, setData] = useState<PolychatData | undefined>();

    useEffect(() => {
        let ignore = false;
        setData(undefined);
        setError(undefined);
        if (!polychatId) return;
        setIsLoading(true);
        fetch(`${Bun.env.POLYCHAT_PROVISIONING_API}/api/2024-01/polychat/${polychatId}`).then(async (res) => {
            if (ignore) return;
            if (!res.ok) {
                setError('Failed to fetch polychat info.');
                return;
            }
            const data = await res.json();
            if (ignore) return;
            setData(data);
            setError(undefined);
            setIsLoading(false);
        });

        return () => {
            ignore = true;
        }
    }, [polychatId]);

    return [isLoading, error, data];
}