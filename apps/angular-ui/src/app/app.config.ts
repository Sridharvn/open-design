import {
  ApplicationConfig,
  provideExperimentalZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { routes } from './app.routes';
import { errorInterceptor } from './interceptors/error.interceptor';
import { loadingInterceptor } from './interceptors/loading.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    // Router with view transitions and signal-based input binding
    provideRouter(
      routes,
      withViewTransitions(),
      withComponentInputBinding(),
    ),

    // HTTP with Fetch API transport + global interceptors
    provideHttpClient(
      withFetch(),
      withInterceptors([errorInterceptor, loadingInterceptor]),
    ),

    // Async animation loading (lazy Material animations)
    provideAnimationsAsync(),

    // Zoneless change detection (Angular 21 default for signal-based apps)
    provideExperimentalZonelessChangeDetection(),
  ],
};
