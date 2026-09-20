// This file can be replaced during build by using the `fileReplacements` array.
// `ng build --configuration production` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

import { environment as defaultEnv } from './environment.idea';

// @idea: we load the default env variables from another file so we don't have to repeat the values for dev and prod
export const environment = Object.assign({}, defaultEnv, {
  debug: true
});
