console.log('POLYCHAT_PROVISIONING_API', Bun.env.POLYCHAT_PROVISIONING_API);
console.log('UNSTABLE_FEATURES', Bun.env.UNSTABLE_FEATURES);
console.log('VERSION_HASH', Bun.env.VERSION_HASH);
console.log('VERSION_NAME', Bun.env.VERSION_NAME);

await Bun.build({
    entrypoints: ['./src/index.tsx'],
    outdir: Bun.env.PATH_OUTPUT ?? '../public',
    target: 'browser',
    minify: true,
    define: {
        'Bun.env.POLYCHAT_PROVISIONING_API': JSON.stringify(Bun.env.POLYCHAT_PROVISIONING_API),
        'Bun.env.UNSTABLE_FEATURES': JSON.stringify(Bun.env.UNSTABLE_FEATURES),
        'Bun.env.VERSION_HASH': JSON.stringify(Bun.env.VERSION_HASH),
        'Bun.env.VERSION_NAME': JSON.stringify(Bun.env.VERSION_NAME),
    },
});
