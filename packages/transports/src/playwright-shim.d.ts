/**
 * Playwright is an optional peer dependency: it is loaded lazily and this
 * ambient declaration keeps the build green when it is absent. The real
 * shapes live in `playwright.ts` as local structural interfaces, so no
 * `any` leaks into the public API.
 */
declare module "playwright" {
  const playwright: unknown;
  export = playwright;
}
