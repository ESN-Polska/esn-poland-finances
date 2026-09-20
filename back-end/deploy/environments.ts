/**
 * AWS Deployment Environment Parameters
 * ESN Poland Finances
 */

export const PROJECT = 'esn-poland-finances';
export const DOMAIN = 'finances.esn-poland.link';
export const PROD_CUSTOM_DOMAIN: string | null = 'finances.esn.pl';

export const parameters: Parameters = {
  project: PROJECT,
  apiDomain: 'api.'.concat(DOMAIN),
  mediaDomain: 'media.'.concat(DOMAIN),
  frontEndCertificateARN: PROD_CUSTOM_DOMAIN
    ? 'arn:aws:acm:us-east-1:628327813110:certificate/d5abfa82-e57f-4b04-9c4d-ffa7d686a700'
    : undefined
};

export const stages: { [stage: string]: Stage } = {
  prod: {
    domain: DOMAIN,
    alternativeDomains: PROD_CUSTOM_DOMAIN ? [PROD_CUSTOM_DOMAIN] : undefined,
    destroyDataOnDelete: false,
    logLevel: 'INFO'
  },
  dev: {
    domain: 'dev.'.concat(DOMAIN),
    destroyDataOnDelete: true,
    logLevel: 'DEBUG'
  }
};

export interface Parameters {
  project: string;
  apiDomain: string;
  mediaDomain: string;
  frontEndCertificateARN?: string;
}

export interface Stage {
  domain: string;
  alternativeDomains?: string[];
  destroyDataOnDelete: boolean;
  logLevel?: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
}
