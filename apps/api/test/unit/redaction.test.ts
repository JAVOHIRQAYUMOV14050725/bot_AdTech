import { strict as assert } from 'assert';
import { prepareLogValue } from '../../src/common/logging/structured-logger.service';

export const runRedactionTests = () => {
    const jwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const payload: Record<string, unknown> = {
        password: 'super-secret',
        token: 'plain-token',
        nested: {
            refreshToken: 'refresh-secret',
            accessToken: 'access-secret',
            apiKey: 'api-secret',
            headers: {
                authorization: `Bearer ${jwt}`,
                'set-cookie': 'session=abc',
                'x-api-key': 'key-123',
            },
        },
        jwt,
    };

    (payload as Record<string, unknown>).self = payload;

    const redacted = prepareLogValue(payload) as Record<string, any>;

    assert.equal(redacted.password, '[REDACTED]');
    assert.equal(redacted.token, '[REDACTED]');
    assert.equal(redacted.nested.refreshToken, '[REDACTED]');
    assert.equal(redacted.nested.accessToken, '[REDACTED]');
    assert.equal(redacted.nested.apiKey, '[REDACTED]');
    assert.equal(redacted.nested.headers.authorization, '[REDACTED]');
    assert.equal(redacted.nested.headers['set-cookie'], '[REDACTED]');
    assert.equal(redacted.nested.headers['x-api-key'], '[REDACTED]');
    assert.equal(redacted.jwt, '[REDACTED]');
    assert.equal(redacted.self, '[Circular]');
};