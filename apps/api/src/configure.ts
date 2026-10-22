import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Shared by main.ts and tests so both run the same app setup. */
export function configureApp(app: INestApplication): void {
  const origins = (process.env.WEB_ORIGINS ?? 'http://localhost:3000').split(',');
  app.enableCors({ origin: origins });
  app.enableShutdownHooks();
  const doc = new DocumentBuilder()
    .setTitle('CROP API')
    .setVersion('0.1')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-tenant', description: 'Agency slug, only needed if you belong to more than one' }, 'tenant')
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, doc));
}
