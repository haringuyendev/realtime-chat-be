import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useStaticAssets(join(__dirname, '..', 'public'), { prefix: '/' });  // Serve /uploads
  app.enableCors({
    origin: ['http://localhost:3002', 'http://192.168.1.11:3002', '*'],
    credentials: true,
  });
  await app.listen(3001, '0.0.0.0');
}
bootstrap();