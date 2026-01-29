module.exports = {
    apps: [
        {
            name: 'bot-adtech-api',
            script: 'dist/main.js',
            env: {
                NODE_ENV: 'production',
                PORT: '4002',
                DATABASE_URL: process.env.DATABASE_URL,
            },
        },
    ],
};
