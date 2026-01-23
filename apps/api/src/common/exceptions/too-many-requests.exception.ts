import { HttpException, HttpStatus } from '@nestjs/common';

export class TooManyRequestsException extends HttpException {
    constructor(message = 'Too many requests') {
        super(
            {
                statusCode: HttpStatus.TOO_MANY_REQUESTS,
                message,
                error: 'Too Many Requests',
            },
            HttpStatus.TOO_MANY_REQUESTS,
        );
    }
}
