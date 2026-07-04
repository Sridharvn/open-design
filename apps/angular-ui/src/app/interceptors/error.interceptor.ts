import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { AppStore } from '../stores/app.store';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const store = inject(AppStore);

  return next(req).pipe(
    catchError((error) => {
      console.error('HTTP Error:', error);
      store.setError(error.message || 'An unexpected error occurred');
      return throwError(() => error);
    })
  );
};
