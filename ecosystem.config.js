const path = require('path');

const apiCwd = path.join(__dirname, 'apps', 'api');

module.exports = {
    apps: [
        {
            name: 'bot_adtech_api',
            cwd: apiCwd,
            script: path.join(apiCwd, 'dist', 'main.js'),
            node_args: [
                '--trace-uncaught',
                '--trace-warnings',
                '--unhandled-rejections=strict',
            ].join(' '),
            instances: 1,
            exec_mode: 'fork',
            min_uptime: '10s',
            max_restarts: 5,
            restart_delay: 5000,
            exp_backoff_restart_delay: 1000,
            env: {
                NODE_ENV: 'development',
                PORT: 4002,
            },
            env_production: {
                NODE_ENV: 'production',
                PORT: 4002,
            },
        },
        {
            name: 'bot_adtech_worker',
            cwd: apiCwd,
            script: path.join(apiCwd, 'dist', 'main.js'),
            node_args: [
                '--trace-uncaught',
                '--trace-warnings',
                '--unhandled-rejections=strict',
            ].join(' '),
            instances: 1,
            exec_mode: 'fork',
            min_uptime: '10s',
            max_restarts: 5,
            restart_delay: 5000,
            exp_backoff_restart_delay: 1000,
            env: {
                NODE_ENV: 'development',
                WORKER_MODE: '1',
            },
            env_production: {
                NODE_ENV: 'production',
                WORKER_MODE: '1',
            },
        },
    ],
};