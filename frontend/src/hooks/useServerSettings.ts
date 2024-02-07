import React, { useEffect, useState } from 'react';

export type ServerSettingsData = {
    networks: string[],
};

/**
 * @returns [ isLoading, error, data ]
 */
export function useServerSettings(): [boolean, string | undefined, ServerSettingsData | undefined ] {
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | undefined>();
    const [data, setData] = useState<ServerSettingsData | undefined>();

    useEffect(() => {
        let ignore = false;
        setData(undefined);
        setError(undefined);
        setIsLoading(true);
        fetch(`${Bun.env.POLYCHAT_PROVISIONING_API}/api/2024-01/settings`).then(async (res) => {
            if (ignore) return;
            if (!res.ok) {
                setError('Failed to fetch server settings.');
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
    }, []);

    return [isLoading, error, data];
}