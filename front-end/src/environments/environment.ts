import { parameters, stages } from '../../../back-end/deploy/environments';

/**
 * The stage to use for API requests ('dev' | 'prod').
 * Can be configured manually here or automatically via release.sh (VITE_STAGE).
 */
const DEFAULT_STAGE: 'dev' | 'prod' = 'dev';
const STAGE: 'dev' | 'prod' = (import.meta.env.VITE_STAGE as 'dev' | 'prod') || DEFAULT_STAGE;

/**
 * Variables to configure ESN Poland Finances cloud app.
 */
export const environment = {
  app: {
    version: '1.0.0',
    mediaUrl: 'https://'.concat(parameters.mediaDomain),
    maxFileUploadSizeMB: 50
  },
  api: {
    url: parameters.apiDomain,
    stage: STAGE
  },
  stage: STAGE,
  parameters,
  stages
};
