import { parameters } from '../../../back-end/deploy/environments';

/**
 * The stage to use for API requests ('dev' | 'prod').
 */
const STAGE = 'dev';

/**
 * Variables to configure an ITER IDEA's cloud app, together with its inner modules.
 */
export const environment = {
  idea: {
    app: {
      version: '1.0.0',
      mediaUrl: 'https://'.concat(parameters.mediaDomain),
      maxFileUploadSizeMB: 50
    },
    api: {
      url: parameters.apiDomain,
      stage: STAGE
    },
    ionicExtraModules: ['common']
  },
  // Convenience aliases for backward compatibility
  stage: STAGE,
  apiDomain: parameters.apiDomain,
  apiUrl: 'https://'.concat(parameters.apiDomain),
  mediaUrl: 'https://'.concat(parameters.mediaDomain),
  parameters
};
