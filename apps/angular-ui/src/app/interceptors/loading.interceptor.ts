import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { finalize } from 'rxjs/operators';
import { AppStore } from '../stores/app.store';

export const loadingInterceptor: HttpInterceptorFn = (req, next) => {
  const store = inject(AppStore);

  store.setLoading(true);

  return next(req).pipe(
    finalize(() => {
      store.setLoading(false);
    })
  );
};
