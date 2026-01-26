import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Request, Response } from 'express';

export function setupSwagger(app: INestApplication): void {
    const enableSwagger =
        process.env.NODE_ENV !== 'production' ||
        process.env.ENABLE_SWAGGER === 'true';

    if (!enableSwagger) return;

    const config = new DocumentBuilder()
        .setTitle('bot_AdTech API')
        .setDescription('AdTech Telegram marketplace API')
        .setVersion('1.0.0')
        .addBearerAuth(
            {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                name: 'Authorization',
                in: 'header',
            },
            'bearer',
        )
        .build();

    const document = SwaggerModule.createDocument(app, config, {
        deepScanRoutes: true,
        ignoreGlobalPrefix: false,
    });

    // Swagger UI: /api/docs
    SwaggerModule.setup('docs', app, document, { useGlobalPrefix: true });

    // Swagger JSON: /api/docs-json
    const httpAdapter = app.getHttpAdapter().getInstance();
    httpAdapter.get('/api/docs-json', (req: Request, res: Response) => res.json(document));
}
