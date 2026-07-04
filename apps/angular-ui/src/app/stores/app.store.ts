import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';

export type AppState = {
  loadingCount: number;
  error: string | null;
};

const initialState: AppState = {
  loadingCount: 0,
  error: null,
};

export const AppStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store) => ({
    setLoading(isLoading: boolean) {
      patchState(store, (state) => ({
        loadingCount: Math.max(0, state.loadingCount + (isLoading ? 1 : -1)),
      }));
    },
    setError(error: string | null) {
      patchState(store, { error });
    },
    clearError() {
      patchState(store, { error: null });
    },
  }))
);
