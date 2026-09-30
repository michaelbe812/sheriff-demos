import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { appRoutes } from './app.routes';
import { provideAuth } from '@blueprint/auth/shell';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    // generated clients use HttpClient; fetch backend (Angular 22 default, explicit here) → MSW sees the requests
    provideHttpClient(withFetch()),
    provideAuth(),
  ],
};
