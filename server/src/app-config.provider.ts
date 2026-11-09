import { Provider } from '@nestjs/common';
import { appConfig } from './config';

export const APP_CONFIG = Symbol('APP_CONFIG');

export const appConfigProvider: Provider = {
  provide: APP_CONFIG,
  useValue: appConfig,
};
