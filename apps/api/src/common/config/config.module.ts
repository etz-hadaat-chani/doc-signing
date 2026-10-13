import { Global, Module } from '@nestjs/common';
import { AppConfig, loadConfig } from './config.schema.js';

/** Checks the environment once, when the app starts; a bad variable stops the API. */
@Global()
@Module({
  providers: [{ provide: AppConfig, useFactory: () => loadConfig(process.env) }],
  exports: [AppConfig],
})
export class ConfigModule {}
