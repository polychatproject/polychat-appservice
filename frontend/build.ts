await Bun.build({
    entrypoints: ['./src/index.tsx'],
    outdir: Bun.env.PATH_OUTPUT ?? '../public',
    target: 'browser',
    minify: true,
    define: {
        'Bun.env.POLYCHAT_PROVISIONING_API': JSON.stringify(Bun.env.POLYCHAT_PROVISIONING_API),
    },
});
