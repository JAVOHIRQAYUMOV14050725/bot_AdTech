import { registerAs } from '@nestjs/config';

export default registerAs('jwt', () => ({
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
    issuer: process.env.JWT_ISSUER ?? 'bot-adtech',
    audience: process.env.JWT_AUDIENCE ?? 'bot-adtech',
}));