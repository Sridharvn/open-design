# Angular Application Architecture

## Technology Stack

| Concern | Technology |
|---|---|
| Framework | Angular 20+ (standalone components, no NgModules) |
| UI Library | Angular Material 3 (M3 theme engine) |
| State Management | NgRx SignalStore (`@ngrx/signals`, `@ngrx/signals/entities`) |
| Async | RxJS — `rxMethod` bridges signals and observables |
| HTTP | Angular `HttpClient` configured with `withFetch()` (browser Fetch API) |
| Charts | Chart.js (standard charts) + D3.js (specialized visualizations only) |
| Testing | Vitest + Angular TestBed |
| Styling | SCSS with a centralized design-token system (CSS custom properties) |

---

## Folder Structure

```
src/app/
  app.config.ts          — Root providers (bootstrap point)
  app.routes.ts          — Top-level lazy route definitions
  app.ts / app.html      — Root component (shell mount)
  models/                — Pure TypeScript interfaces (no classes, no logic)
  constants/             — Static lookup tables and route path constants
  services/              — HTTP wrappers + utility services
  stores/                — NgRx SignalStore global state slices
  interceptors/          — Functional HTTP interceptors
  guards/                — Route guards (auth, guest, role-based)
  pages/                 — Routed page components (lazy-loaded)
  components/            — Shared/reusable UI components
  layouts/               — App shell (header + breadcrumb + footer)
  pipes/                 — Custom Angular pipes
  assets/                — Static files (geo data, fonts, icons)
  environments/          — Environment-specific config (API base URLs)
  styles/                — Global SCSS partials (design tokens)
```

---

## Layer Responsibilities

### 1. Models (`models/`)

Pure TypeScript `interface` and `type` definitions — no classes, no logic. One file per domain area. They define:

- **API shapes** — what the server sends and receives
- **State shapes** — the structure stored in each SignalStore
- **UI types** — shared enums and union types used by components (`ButtonVariant`, `ChipType`, `DropdownOption<T>`, etc.)
- **Filter shapes** — typed filter objects passed to API services

> **Rule:** Nothing in `models/` imports from services, stores, or components. Models are the lowest layer — all other layers import from them.

---

### 2. Constants (`constants/`)

Two files:

- **`app-constants.ts`** — Static lookup tables (column definitions, status maps, page-size options, polling intervals). Safe to import from any layer.
- **`app-routes.ts`** — Single source of truth for all route path strings. Exports a typed `APP_ROUTES` object (all paths with leading slash) and helper functions:
  - `toSegment(path)` — strips leading `/` for Angular `path:` definitions
  - `withIdParam(path)` — appends `/:id`
  - Additional path-builder helpers as needed

> **Rule:** Never hardcode a path string anywhere in the app. Always use `APP_ROUTES.*` constants.

```ts
// app-routes.ts
export const APP_ROUTES = {
  root: '/',
  login: '/login',
  dashboard: '/dashboard',
  featureList: '/feature',
  featureDetail: '/feature/items',
} as const;

export function toSegment(path: string): string {
  return path.startsWith('/') ? path.slice(1) : path;
}

export function withIdParam(path: string): string {
  return `${toSegment(path)}/:id`;
}
```

---

### 3. Services (`services/`)

Two distinct categories:

#### 3a. `ApiService` — the HTTP base layer

The single class all feature services inject. Wraps `HttpClient` with typed, consistent methods:

```ts
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.baseUrl;

  get<T>(path: string, params?: Record<string, string | number | boolean>, options?: ApiOptions): Observable<T>
  post<T>(path: string, body: unknown, options?: ApiOptions): Observable<T>
  put<T>(path: string, body: unknown, options?: ApiOptions): Observable<T>
  patch<T>(path: string, body: unknown, options?: ApiOptions): Observable<T>
  delete<T>(path: string, options?: ApiOptions): Observable<T>
}
```

- Accepts an optional `ApiOptions { baseUrl?, context? }` to override the default base URL or carry `HttpContext` tokens
- GET requests include cache-busting headers to prevent stale 304 responses when using `withFetch()`
- **Never inject** `HttpClient` directly in feature code — all feature services go through `ApiService`

**Exception:** Multipart `FormData` uploads inject `HttpClient` directly because `ApiService` would set `Content-Type: application/json`, breaking the browser's auto-generated multipart boundary.

#### 3b. Feature API Services — thin HTTP wrappers

One service per API resource. Each translates typed filter objects into raw query params and delegates to `ApiService`:

```ts
@Injectable({ providedIn: 'root' })
export class FeatureApiService {
  private readonly api = inject(ApiService);
  private readonly resource = 'api/v1/some-resource';

  list(filters?: Partial<FeatureFilters>): Observable<FeatureListResponse> {
    const params: Record<string, string | number | boolean> = {};
    if (filters?.search) params['search'] = filters.search;
    if (filters?.page !== undefined) params['page'] = filters.page;
    return this.api.get<FeatureListResponse>(this.resource, params);
  }

  getById(id: string): Observable<FeatureDetail> {
    return this.api.get<FeatureDetail>(`${this.resource}/${id}`);
  }
}
```

Each method returns a typed `Observable<T>` — no error handling here (the error interceptor handles it globally).

#### 3c. Utility Services

| Service | Purpose |
|---|---|
| `NotificationService` | Wraps `MatSnackBar` — `success(msg)` / `error(msg)` |
| `BreadcrumbService` | Holds a `signal<BreadcrumbItem[]>()` that pages write and `BaseLayout` reads |
| `DateFormatService` | Formats ISO strings — `formatDateTime()`, `formatRelative()`, `formatDateTimeOrDash()` |
| `ButtonLoadingService` | Per-button async loading state, keyed by string; bridges with `loadingInterceptor` via `HttpContext` token |

---

### 4. Interceptors (`interceptors/`)

Three **functional interceptors** (`HttpInterceptorFn`) registered in `app.config.ts` via `withInterceptors([...])`:

```ts
// app.config.ts
provideHttpClient(
  withFetch(),
  withInterceptors([authInterceptor, errorInterceptor, loadingInterceptor])
)
```

| Interceptor | Role |
|---|---|
| `authInterceptor` | Reads the JWT token from the auth store; clones the request with `Authorization: Bearer <token>` for requests targeting configured base URLs. On a 401 response (only when a token was present), calls the store's `logout()` method and navigates to `/login` with a `returnUrl` query param. |
| `errorInterceptor` | Catches all HTTP errors, extracts a human-readable message from the error body, and calls `NotificationService.error()`. Feature code **never needs** to show error toasts for HTTP failures. |
| `loadingInterceptor` | Reads a `BUTTON_LOADING_KEY` token from `HttpContext`; calls `ButtonLoadingService.start(key)` before the request and `stop(key)` in `finalize()`. This wires per-button spinners transparently to any HTTP call. |

---

### 5. Stores (`stores/`) — NgRx SignalStore

The global state layer. Each store is a standalone Signal-based state slice using `signalStore()`.

#### Store anatomy

```ts
export const FeatureStore = signalStore(
  { providedIn: 'root' },            // (1) singleton, injectable anywhere
  withEntities<FeatureEntity>(),      // (2) optional: entity collection with built-in selectors
  withState(initialState),            // (3) full state shape
  withComputed(store => ({            // (4) derived signals — never duplicate state
    totalPages: computed(() => Math.ceil(store.total() / store.pageSize())),
    filterOptions: computed(() => store.items().map(i => ({ label: i.name, value: i.id }))),
  })),
  withMethods(store => {              // (5) public API — all async ops via rxMethod
    const api = inject(FeatureApiService);

    const load = rxMethod<Partial<FeatureFilters>>(filters$ => filters$.pipe(
      debounceTime(300),
      tap(() => patchState(store, { loading: true })),
      switchMap(filters => api.list(filters)),
      tap({
        next: resp => patchState(store, setAllEntities(resp.data), {
          total: resp.total,
          loading: false,
        }),
        error: () => patchState(store, { loading: false }),
      }),
    ));

    return {
      load(filters: Partial<FeatureFilters>) { load(filters); },
      setFilters(f: Partial<FeatureFilters>) {
        patchState(store, { filters: f, currentPage: 1 });
        load(f);
      },
    };
  }),
);
```

#### Key patterns

- **`patchState(store, partialState)`** is the only way to update state — never mutate signals directly.
- **`withEntities<T>()`** provides `entities` (array signal), `entityMap` (record signal), `ids` (array signal), and imperative helpers: `setAllEntities`, `addEntities`, `updateEntity`, `removeEntity`.
- **`rxMethod`** is used for all async operations. It accepts a signal or Observable trigger and returns a callable function. Internally uses RxJS operators (`switchMap`, `exhaustMap`, `debounceTime`, `forkJoin`).
- **`forkJoin`** batches parallel API calls (e.g., loading reference/lookup data in one round-trip).
- State updates that depend on previous state use the **callback form**: `patchState(store, state => ({ count: state.count() + 1 }))`.
- Use `debounceTime(300)` in all filter/search `rxMethod` pipelines.

#### Common store types

| Store type | Concerns |
|---|---|
| **Auth store** | JWT token, current user, roles, plant/org IDs. Rehydrates from `sessionStorage` on load; decodes JWT; `meLoaded` flag for guard safety on hard refresh. |
| **Feature list store** | Entity collection + filters + pagination + reference/lookup data (statuses, severities, etc.). |
| **Dashboard store** | Summary statistics, chart data (pie/bar/line), filter options, role-differentiated state. |
| **Comment store** | Comment entities per parent item; nested replies map; category filter; pagination. |
| **Notification store** | Unread count + paginated list; mark-all-read action. |
| **File upload store** | Upload progress, upload history, contextual options (e.g., plant/location). |

---

### 6. Guards (`guards/`)

Functional route guards (`CanActivateFn`). Two categories:

#### Authentication guards

```ts
export const authGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const token = inject(AuthStore).token();

  if (token) return true;

  return router.createUrlTree([APP_ROUTES.login], {
    queryParams: { returnUrl: state.url },
  });
};
```

- **`authGuard`** — Redirects unauthenticated users to `/login?returnUrl=<current-url>`.
- **`guestGuard`** — Redirects authenticated users away from public pages (login, register).

#### Role-based guards

```ts
export const featureGuard: CanActivateFn = () => {
  const router = inject(Router);
  const userStore = inject(AuthStore);

  if (userStore.meLoaded()) {
    return checkRole(userStore, router);
  }

  // Hard-refresh safety: /me has not resolved yet. Wait for it.
  userStore.loadMe();
  return toObservable(userStore.meLoaded).pipe(
    filter(Boolean),
    take(1),
    map(() => checkRole(userStore, router)),
  );
};
```

- Evaluate roles against an `ALLOWED_ROLES` list.
- **Hard-refresh safety pattern:** On hard refresh the `/me` response may not have arrived yet. The guard triggers `loadMe()` and converts the `meLoaded` signal to an Observable via `toObservable()`, piping through `filter(Boolean), take(1)` before evaluating the role.

---

### 7. Pages (`pages/`)

All page components are **lazy-loaded** via `loadComponent`:

```ts
{
  path: toSegment(APP_ROUTES.featureList),
  loadComponent: () =>
    import('./pages/feature-list/feature-list').then(m => m.FeatureList),
  canActivate: [authGuard],
  data: { type: 'variant-a' },
}
```

Each page component:

1. Calls `BreadcrumbService.set([...])` in its **constructor** so `BaseLayout` renders the correct trail immediately.
2. Reads `route.data['type']` when it is a **shared page** serving multiple content variants — allows a single page class to select the correct store and API service at runtime.
3. Injects the relevant store(s) and calls load methods on initialization (typically in `constructor` or with an `effect()`).
4. Uses `ChangeDetectionStrategy.OnPush` — all state flows from signals/computed, not mutable class properties.
5. Does **not** handle HTTP errors — the error interceptor does that globally.

#### Shared page pattern

A single page component is registered at multiple routes with different `data.type` values:

```ts
// Same component, different route data
{ path: 'items/type-a', loadComponent: ..., data: { type: 'a' } },
{ path: 'items/type-b', loadComponent: ..., data: { type: 'b' } },

// Inside the component:
readonly type = inject(ActivatedRoute).snapshot.data['type'] as 'a' | 'b';
readonly store = this.type === 'a' ? inject(StoreA) : inject(StoreB);
```

---

### 8. Components (`components/`)

Shared, reusable UI components. Every component follows these conventions:

- **Standalone** by default (no `standalone: true` decorator needed in Angular v20+)
- **`ChangeDetectionStrategy.OnPush`** on every component
- **Signal inputs** using `input()` / `model()` (two-way) instead of `@Input()` decorators
- **Signal outputs** using `output()` instead of `@Output()` decorators
- **`computed()`** for all derived display values
- **`host` object** in `@Component` for host bindings/listeners — no `@HostBinding`/`@HostListener`
- **Native control flow** (`@if`, `@for`, `@switch`) in templates — no structural directives
- **No arrow functions in templates** — bind to named component methods
- **`[class]` / `[style]` bindings** — no `ngClass` / `ngStyle`

```ts
@Component({
  selector: 'app-feature-item',
  imports: [MatIconModule],
  template: `
    <div [class]="containerClass()">
      @if (showLabel()) {
        <span>{{ label() }}</span>
      }
      <button (click)="handleAction()">
        <mat-icon>{{ icon() }}</mat-icon>
      </button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureItem {
  readonly label = input<string>('');
  readonly icon = input<string>('info');
  readonly showLabel = input<boolean>(true);
  readonly variant = input<'primary' | 'secondary'>('primary');

  readonly actionClicked = output<void>();

  readonly containerClass = computed(() => \`item item--\${this.variant()}\`);

  handleAction(): void {
    this.actionClicked.emit();
  }
}
```

#### Dialog components

Dialogs support two usage modes: **standalone** (directly in a template with `(cancelled)` / `(submitted)` outputs) or **via `MatDialog.open()`**. To support both, they inject `MatDialogRef` and `MAT_DIALOG_DATA` with `{ optional: true }`.

```ts
export class FeatureDialog {
  private readonly dialogRef = inject(MatDialogRef, { optional: true });
  private readonly dialogData = inject(MAT_DIALOG_DATA, { optional: true });

  // Works both standalone (outputs) and as a dialog (closes ref)
  handleSubmit(value: FeatureFormValue): void {
    this.submitted.emit(value);
    this.dialogRef?.close(value);
  }
}
```

#### ControlValueAccessor components

Form field components implement `ControlValueAccessor` to integrate with Angular Reactive Forms. They self-register with `NG_VALUE_ACCESSOR` using `useExisting`.

#### Content projection with marker directives

Some container components use a zero-logic `@Directive({ selector: '[markerName]' })` as a content-projection marker, detected inside the host with `contentChild(MarkerDirective)`.

#### Chart components

Chart.js components follow a strict lifecycle:
1. Create the chart instance in `ngAfterViewInit`
2. Destroy it in `DestroyRef.onDestroy`
3. Use `effect()` to call `chart.update()` when signal inputs change
4. Use a shared tooltip utility factory for all DOM-positioned, viewport-clamped pinned tooltips

---

### 9. Layouts (`layouts/`)

`BaseLayout` is the application shell component. It:

- Composes `Header` + `app-breadcrumb` + `<ng-content>` + `Footer`
- On construction, calls `AuthStore.loadMe()` if a token exists (to populate the full user profile)
- Starts a `timer(0, POLL_INTERVAL)` that periodically polls a notification count endpoint
- Reads `BreadcrumbService.items` signal to pass to `app-breadcrumb`
- Handles top-level navigation actions (logout, section/dashboard switch)

All authenticated pages are rendered inside `BaseLayout`.

---

### 10. Pipes (`pipes/`)

Custom Angular pipes for template transformations. Pipes should be stateless and pure.

```ts
@Pipe({ name: 'featurePipe' })
export class FeaturePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return value ?? '—';
  }
}
```

> **Security note:** Any pipe that calls `DomSanitizer.bypassSecurityTrustHtml()` must only be used on content that has already been sanitized at the API layer (e.g., content from an authenticated rich-text editor). Never pipe raw untrusted strings through it.

---

### 11. Theming (`styles/`)

- **Framework:** Angular Material 3 with `mat.theme()` in `styles.scss`
- **Color scheme:** Dark mode only (`color-scheme: dark`)
- **Design tokens:** All styling uses CSS custom properties defined in `src/styles/_variables.scss`. Raw color values, spacing values, or border-radius values are never hardcoded in component SCSS files.
- **Token groups:** base colors, surface/background, component-specific colors, chip/status colors, gradients, RAG status colors, typography scale, spacing scale, border radii, layout constants.
- **Material tokens:** `var(--mat-sys-*)` for Angular Material system tokens.
- **Custom fonts:** Declared via `@font-face` in `_variables.scss` and served from `public/fonts/`.

```scss
// Usage in component SCSS
.my-component {
  color: var(--app-color-text-primary);
  background: var(--app-gradient-card-bg);
  border-radius: var(--app-border-radius-sm);
  padding: var(--app-spacing-4);
  font-size: var(--app-font-size-sm);
}
```

---

## Data Flow

```
User Action
    │
    ▼
Page / Component
    │  calls store method
    ▼
Store (NgRx SignalStore)
    │  rxMethod pipeline (debounce → switchMap)
    ▼
Feature API Service
    │  delegates to ApiService
    ▼
ApiService (HttpClient wrapper)
    │
    ├── authInterceptor    → attaches Bearer token
    ├── loadingInterceptor → starts/stops per-button spinner
    └── errorInterceptor   → shows snackbar on failure
    │
    ▼
REST API (one or more base URLs)
    │
    ▼
Store (patchState → signals update)
    │
    ▼
Components (re-render via OnPush + signal reads)
```

---

## Authentication Flow

1. Login page posts credentials → `AuthApiService.login()` → receives `{ access_token }`.
2. Auth store stores the JWT in `sessionStorage`, decodes it (base64 → JSON), populates `currentUser` and `token` signals.
3. `authInterceptor` reads the token on every request; appends `Authorization: Bearer` header.
4. On 401 (when a token was present): the store's `logout()` clears `sessionStorage` + resets state; router navigates to `/login`.
5. On hard refresh: the store constructor calls a `rehydrateToken()` helper — reads `sessionStorage`, decodes the JWT, discards if expired, otherwise restores state synchronously before the first HTTP call.

---

## Routing Architecture

- All routes use `loadComponent` for **lazy loading** — each page is a separate code chunk.
- `authGuard` protects all private routes; `guestGuard` protects public auth routes.
- **Shared page pattern:** A single page component handles multiple content variants via `route.data.type`.
- Route path strings are never hardcoded — all uses reference `APP_ROUTES.*` constants.

```ts
// routes definition
export const routes: Routes = [
  { path: '', redirectTo: toSegment(APP_ROUTES.dashboard), pathMatch: 'full' },
  {
    path: toSegment(APP_ROUTES.dashboard),
    loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.Dashboard),
    canActivate: [authGuard],
  },
  {
    path: withIdParam(APP_ROUTES.featureItems),
    loadComponent: () => import('./pages/detail/detail').then(m => m.Detail),
    canActivate: [authGuard],
    data: { type: 'variant-a' },
  },
  {
    path: toSegment(APP_ROUTES.login),
    loadComponent: () => import('./pages/login/login').then(m => m.Login),
    canActivate: [guestGuard],
  },
  { path: '**', redirectTo: toSegment(APP_ROUTES.dashboard) },
];
```

---

## Multi-Base-URL Pattern

When the application needs to talk to more than one backend service, each is configured as a named URL in `environment.ts`:

```ts
export const environment = {
  baseUrl: 'https://api.example.com/feature/',
  authBaseUrl: 'https://api.example.com/auth/api/v1/',
  workflowBaseUrl: 'https://api.example.com/workflow/api/v1/',
};
```

`ApiService` defaults to `baseUrl`. To target another service, pass `{ baseUrl: environment.workflowBaseUrl }` in `ApiOptions`. The `authInterceptor` applies Bearer token attachment to **all configured base URLs**.

```ts
// Targeting a non-default base URL
getSla(id: string): Observable<SlaResponse> {
  return this.api.get<SlaResponse>(
    `api/v1/sla/${id}`,
    undefined,
    { baseUrl: environment.workflowBaseUrl }
  );
}
```

---

## Key Rules Summary

| Rule | Reason |
|---|---|
| Do NOT set `standalone: true` | It is the default in Angular v20+ |
| Do NOT inject `HttpClient` directly in feature code | All HTTP goes through `ApiService` |
| Do NOT call `Signal.mutate()` | Removed; use `patchState` / `.set()` / `.update()` |
| Do NOT write arrow functions in templates | Not supported by the Angular template compiler |
| Do NOT use `ngClass` / `ngStyle` | Use `[class]` / `[style]` bindings instead |
| Do NOT use `@HostBinding` / `@HostListener` | Use the `host` object in `@Component` / `@Directive` |
| Do NOT hardcode route strings | Use `APP_ROUTES.*` constants everywhere |
| Always use `ChangeDetectionStrategy.OnPush` | Required on every component |
| Always call `BreadcrumbService.set()` in page constructors | Otherwise the breadcrumb renders empty |
| Format all dates through `DateFormatService` | Never use `DatePipe` directly on ISO strings |
| Use design tokens for all styles | Never use raw colors, spacing, or border-radius values |
| All components must pass WCAG AA | Focus management, color contrast, and ARIA attributes are required |
