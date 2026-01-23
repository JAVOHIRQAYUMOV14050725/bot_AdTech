import { applyDecorators } from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiConflictResponse,
    ApiForbiddenResponse,
    ApiNotFoundResponse,
    ApiTooManyRequestsResponse,
    ApiUnauthorizedResponse,
    ApiUnprocessableEntityResponse,
    ApiInternalServerErrorResponse,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from './api-error-response.dto';

export function ApiStandardErrorResponses() {
    return applyDecorators(
        ApiBadRequestResponse({
            description: 'Bad Request',
            type: ApiErrorResponseDto,
        }),
        ApiUnauthorizedResponse({
            description: 'Unauthorized',
            type: ApiErrorResponseDto,
        }),
        ApiForbiddenResponse({
            description: 'Forbidden',
            type: ApiErrorResponseDto,
        }),
        ApiNotFoundResponse({
            description: 'Not Found',
            type: ApiErrorResponseDto,
        }),
        ApiConflictResponse({
            description: 'Conflict',
            type: ApiErrorResponseDto,
        }),
        ApiUnprocessableEntityResponse({
            description: 'Unprocessable Entity',
            type: ApiErrorResponseDto,
        }),
        ApiTooManyRequestsResponse({
            description: 'Too Many Requests',
            type: ApiErrorResponseDto,
        }),
        ApiInternalServerErrorResponse({
            description: 'Internal Server Error',
            type: ApiErrorResponseDto,
        }),
    );
}
