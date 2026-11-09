import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { appConfig } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('WCO-DL')
    .setDescription('Anime downloader from WCO site')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // The bundled client is same-origin; CORS only matters for external UIs.
  app.enableCors({
    origin: appConfig.corsOrigin,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  await app.listen(appConfig.port, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`Listening on port ${appConfig.port}`);
  logger.log(`Byparr: ${appConfig.byparrUrl}`);
  logger.log(
    `Sonarr: ${appConfig.sonarrUrl}${appConfig.sonarrApiKey ? '' : ' (SONARR_API_KEY not set, imports disabled)'}`,
  );
}
bootstrap();
