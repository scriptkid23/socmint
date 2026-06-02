import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('SOCMINT Automation API')
    .setDescription('Browser profile management and CloakBrowser automation runs')
    .setVersion('1.0')
    .addTag('profiles', 'Browser profile CRUD')
    .addTag('sessions', 'Interactive login sessions')
    .addTag('runs', 'Automation run execution')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
}
