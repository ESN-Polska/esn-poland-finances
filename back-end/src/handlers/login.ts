import { default as Axios } from 'axios';
import { sign } from 'jsonwebtoken';
import { DynamoDB, HandledError, ResourceController, SystemsManager } from 'idea-aws';

import { User } from '../models/user.model';
import { Configurations } from '../models/configurations.model';

const OAUTH_TOKEN_URL = 'https://accounts.esn.org/oauth/token';
const OAUTH_USERINFO_URL = 'https://accounts.esn.org/oauth/v1/userinfo';
const JWT_EXPIRE_TIME = '7 days';

const PROJECT = process.env.PROJECT || 'esn-poland-finances';
const APP_DOMAIN = process.env.APP_DOMAIN || 'finances.esn.pl';
const APP_URL = `https://${APP_DOMAIN}`;

const DDB_TABLES = {
  configurations: process.env.DDB_TABLE_configurations,
  users: process.env.DDB_TABLE_users
};
const ddb = new DynamoDB();

const SECRETS_PATH = `/${PROJECT}/auth`;
const systemsManager = new SystemsManager();

let JWT_SECRET: string;

export const handler = (ev: any, _: any, cb: any): Promise<void> => new Login(ev, cb).handleRequest();

class Login extends ResourceController {
  host: string;

  constructor(event: any, callback: any) {
    super(event, callback);
    this.callback = callback;
    this.host = event.headers?.host ?? null;
    if (process.env.STAGE) {
      this.stage = process.env.STAGE;
    }
  }

  protected async getResources(): Promise<any> {
    const guestToken = this.queryParams?.guestToken;
    if (guestToken) {
      return this.handleGuestLogin(guestToken);
    }

    const code = this.queryParams?.code;
    if (code) {
      const codeVerifier = this.queryParams?.codeVerifier || this.queryParams?.code_verifier;
      const redirectUri = this.queryParams?.redirectUri || this.queryParams?.redirect_uri;
      return this.handleOAuthLogin(code, codeVerifier, redirectUri);
    }

    // When requested without parameters (frontend initializing login flow), return public OAuth config from SSM
    const stage = this.stage || process.env.STAGE || 'dev';
    const clientIdParam = `/${PROJECT}/${stage}/oauth/client_id`;
    let clientId: string | null = null;
    try {
      clientId = await systemsManager.getSecretByName(clientIdParam);
    } catch (err) {
      this.logger.error('Failed to load OAuth clientId from SSM', { clientIdParam, err });
    }

    const origin = (this.event.headers?.origin || this.event.headers?.Origin || '') as string;
    const isLocalOrigin = origin.includes('localhost') || origin.includes('127.0.0.1');
    const defaultRedirectUri = (!isLocalOrigin && origin) ? `${origin.replace(/\/+$/, '')}/auth` : `${APP_URL}/auth`;

    return {
      clientId: clientId || '',
      redirectUri: defaultRedirectUri,
      authorizeUrl: 'https://accounts.esn.org/oauth/authorize',
      scope: 'oauth2_access_to_profile_information'
    };
  }

  protected async postResources(): Promise<any> {
    const guestToken = this.body?.guestToken || this.queryParams?.guestToken;
    if (guestToken) {
      return this.handleGuestLogin(guestToken);
    }

    const code = this.body?.code || this.queryParams?.code;
    if (code) {
      const codeVerifier = this.body?.codeVerifier || this.body?.code_verifier || this.queryParams?.codeVerifier;
      const redirectUri = this.body?.redirectUri || this.body?.redirect_uri || this.queryParams?.redirectUri;
      return this.handleOAuthLogin(code, codeVerifier, redirectUri);
    }

    throw new HandledError('Missing code or guestToken');
  }

  private async handleOAuthLogin(code: string, codeVerifier?: string, redirectUri?: string): Promise<any> {
    const stage = this.stage || process.env.STAGE || 'dev';
    const clientIdParam = `/${PROJECT}/${stage}/oauth/client_id`;
    const clientSecretParam = `/${PROJECT}/${stage}/oauth/client_secret`;

    let clientId: string | null = null;
    let clientSecret: string | null = null;
    try {
      clientId = await systemsManager.getSecretByName(clientIdParam);
      clientSecret = await systemsManager.getSecretByName(clientSecretParam);
    } catch (err) {
      this.logger.error('Failed to load OAuth credentials from SSM', { clientIdParam, err });
    }

    if (!clientId || !clientSecret) {
      this.logger.error('Missing OAuth credentials in SSM Parameter Store', { stage });
      throw new HandledError('OAuth credentials not configured for this environment');
    }

    const origin = (this.event.headers?.origin || this.event.headers?.Origin || '') as string;
    const isLocalOrigin = origin.includes('localhost') || origin.includes('127.0.0.1');
    const defaultRedirectUri = (!isLocalOrigin && origin) ? `${origin.replace(/\/+$/, '')}/auth` : `${APP_URL}/auth`;
    const effectiveRedirectUri = redirectUri || defaultRedirectUri;

    let accessToken: string;
    try {
      const params = new URLSearchParams();
      params.append('grant_type', 'authorization_code');
      params.append('client_id', clientId);
      params.append('client_secret', clientSecret);
      params.append('code', code);
      params.append('redirect_uri', effectiveRedirectUri);
      if (codeVerifier) {
        params.append('code_verifier', codeVerifier);
      }

      this.logger.info('Exchanging OAuth authorization code with ESN Accounts', {
        effectiveRedirectUri,
        hasCodeVerifier: !!codeVerifier
      });

      const tokenRes = await Axios.post(OAUTH_TOKEN_URL, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      accessToken = tokenRes.data?.access_token;
      if (!accessToken) {
        this.logger.error('Missing access token in OAuth token response', { response: tokenRes.data });
        throw new HandledError('OAuth login failed: missing access token');
      }
    } catch (err: any) {
      const errorDetails = err?.response?.data || err?.message || err;
      this.logger.error('OAuth token exchange failed', { error: errorDetails });
      throw new HandledError('Login failed during OAuth token exchange');
    }

    let userInfo: any;
    try {
      const userInfoRes = await Axios.get(OAUTH_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      userInfo = userInfoRes.data || {};
      this.logger.info('OAuth userinfo fetched successfully', {
        keys: Object.keys(userInfo),
        userId: userInfo.sub
      });
    } catch (err: any) {
      const errorDetails = err?.response?.data || err?.message || err;
      this.logger.error('OAuth userinfo fetch failed', { error: errorDetails });
      throw new HandledError('Failed to fetch user profile from ESN Accounts');
    }

    const userId = String(userInfo.sub).toLowerCase().trim();

    if (!userId) {
      this.logger.error('Missing user identity from OAuth userinfo', { userInfo });
      throw new HandledError('Missing user identity from ESN Accounts');
    }

    const configurations = await this.loadOrInitConfigurations(userId);

    const email = userInfo.esn_email || userInfo.email || '';
    const firstName = userInfo.given_name || '';
    const lastName = userInfo.family_name || '';

    const sectionGroup = Array.isArray(userInfo.detailed_groups)
      ? userInfo.detailed_groups.find((g: any) => g.type === 'section')
      : null;
    const countryGroup = Array.isArray(userInfo.detailed_groups)
      ? userInfo.detailed_groups.find((g: any) => g.type === 'country')
      : null;

    const sectionCode = sectionGroup?.scope || '';
    const section = sectionGroup?.label || '';
    const country = countryGroup?.label || '';
    const avatarURL = userInfo.picture || '';

    let extractedRoles: string[] = [];
    const rawRoles = userInfo.groups || userInfo.roles || userInfo.extended_roles || userInfo.oauth_roles || [];
    if (Array.isArray(rawRoles)) {
      extractedRoles = rawRoles.map((r: any) => (typeof r === 'string' ? r : r?.name || String(r)));
    } else if (typeof rawRoles === 'object' && rawRoles !== null) {
      extractedRoles = Object.values(rawRoles).map((r: any) => (typeof r === 'string' ? r : r?.name || String(r)));
    } else if (typeof rawRoles === 'string') {
      extractedRoles = rawRoles.split(/[\s,]+/);
    }
    extractedRoles = extractedRoles.map(r => (typeof r === 'string' ? r.trim() : '')).filter(Boolean);
    extractedRoles = extractedRoles.filter((item, idx) => extractedRoles.indexOf(item) === idx);

    const user = new User({
      userId,
      email,
      sectionCode,
      firstName,
      lastName,
      roles: extractedRoles,
      extendedRoles: extractedRoles,
      section,
      country,
      avatarURL,
      lastLoginAt: new Date().toISOString(),
      isAdministrator: false
    });
    User.applyConfigurationPermissions(user, configurations);
    this.logger.info('ESN Accounts OAuth login successful', { userId: user.userId, section: user.sectionCode });

    if (configurations.appLocked && !user.isAdministrator) {
      this.logger.warn('Login rejected: application is locked', { userId: user.userId });
      const acceptsJson = (this.event.headers?.accept || '').includes('application/json');
      if (this.httpMethod === 'POST' || (acceptsJson && !this.queryParams?.redirect)) {
        this.returnStatusCode = 403;
        throw new HandledError('The application is temporarily locked');
      }
      this.callback(null, {
        statusCode: 302,
        headers: {
          Location: `${APP_URL}/auth?error=app_locked`
        }
      });
      return;
    }

    if (DDB_TABLES.users) {
      try {
        await ddb.put({
          TableName: DDB_TABLES.users,
          Item: {
            userId: user.userId,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            name: user.getDisplayName(),
            section: user.section,
            sectionCode: user.sectionCode,
            country: user.country,
            avatarURL: user.avatarURL,
            roles: user.roles,
            extendedRoles: user.extendedRoles,
            isAdministrator: user.isAdministrator,
            canManageFinances: user.canManageFinances,
            lastLoginAt: user.lastLoginAt
          }
        });
      } catch (dbErr) {
        this.logger.error('Failed to persist user to DynamoDB', dbErr);
      }
    }

    const userData = JSON.parse(JSON.stringify(user));
    const secret = await getJwtSecret();
    const token = sign(userData, secret, { expiresIn: JWT_EXPIRE_TIME });

    const acceptsJson = (this.event.headers?.accept || '').includes('application/json');
    if (this.httpMethod === 'POST' || (acceptsJson && !this.queryParams?.redirect)) {
      return { token, user: userData };
    }

    this.callback(null, {
      statusCode: 302,
      headers: {
        Location: `${APP_URL}/auth?token=${token}`
      }
    });
  }

  private async handleGuestLogin(guestToken: string): Promise<any> {
    const configurations = await this.loadConfigurations();
    if (configurations.appLocked) {
      throw new HandledError('The application is temporarily locked');
    }
    if (!configurations.guestAccessEnabled) {
      throw new HandledError('Guest access is currently disabled');
    }

    const invitation = (configurations.guestInvitations || []).find(inv => inv.id === guestToken);
    if (!invitation) {
      throw new HandledError('Invalid guest invitation link');
    }

    if (invitation.status === 'REVOKED') {
      throw new HandledError('This guest invitation has been revoked');
    }

    if (invitation.status === 'USED' && !invitation.isMultiUse) {
      throw new HandledError('This guest invitation link has already been used');
    }

    const now = new Date().toISOString();
    if (invitation.expiresAt && invitation.expiresAt < now) {
      throw new HandledError('This guest invitation has expired');
    }

    const shortId = invitation.id.replace(/-/g, '').slice(0, 10);
    const guestUser = new User({
      userId: `guest_${shortId}`,
      email: invitation.guestEmail,
      firstName: invitation.guestName,
      lastName: '',
      section: '',
      sectionCode: '',
      country: 'Guest',
      roles: ['GUEST'],
      extendedRoles: [],
      isAdministrator: false,
      isManager: false,
      isAuditor: false,
      canManageFinances: false,
      isGuest: true,
      guestInvitationId: invitation.id,
      guestPurpose: invitation.purpose,
      guestPosition: invitation.position,
      guestDefaultSourceOfFunding: invitation.defaultSourceOfFunding,
      guestAllowedRequestTypes: invitation.allowedRequestTypes || configurations.guestAccessAllowedRequestTypes,
      guestMaxAmount: invitation.maxAmount,
      guestInstructions: invitation.instructions,
      lastLoginAt: now
    });

    // Persist guest user to DynamoDB users table
    if (DDB_TABLES.users) {
      try {
        await ddb.put({
          TableName: DDB_TABLES.users,
          Item: {
            userId: guestUser.userId,
            email: guestUser.email,
            firstName: guestUser.firstName,
            lastName: '',
            name: guestUser.getDisplayName(),
            section: '',
            sectionCode: '',
            country: '',
            avatarURL: '',
            roles: guestUser.roles,
            extendedRoles: guestUser.extendedRoles,
            isAdministrator: false,
            canManageFinances: false,
            isGuest: true,
            guestInvitationId: guestUser.guestInvitationId,
            guestPurpose: guestUser.guestPurpose,
            guestPosition: guestUser.guestPosition,
            guestDefaultSourceOfFunding: guestUser.guestDefaultSourceOfFunding,
            lastLoginAt: guestUser.lastLoginAt
          }
        });
      } catch (dbErr) {
        this.logger.error('Failed to persist guest user to DynamoDB', dbErr);
      }
    }

    // Update invitation lastAccessedAt in Configurations
    if (DDB_TABLES.configurations) {
      try {
        const invTarget = (configurations.guestInvitations || []).find(i => i.id === invitation.id);
        if (invTarget) {
          invTarget.lastAccessedAt = now;
          await ddb.put({
            TableName: DDB_TABLES.configurations,
            Item: JSON.parse(JSON.stringify(configurations))
          });
        }
      } catch (dbErr) {
        this.logger.error('Failed to update invitation lastAccessedAt in Configurations', dbErr);
      }
    }

    const userData = JSON.parse(JSON.stringify(guestUser));
    const secret = await getJwtSecret();
    const token = sign(userData, secret, { expiresIn: JWT_EXPIRE_TIME });

    // Return JSON payload unless explicit redirect parameter was provided
    if (!this.queryParams.redirect) {
      return { token, user: userData };
    }

    let appURL = APP_URL;
    if (this.queryParams.localhost) {
      const local = String(this.queryParams.localhost);
      const isLocalHost =
        /^\d+$/.test(local) ||
        /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(local) ||
        /^192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(local) ||
        /^10\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(local) ||
        /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(local);

      if (isLocalHost) {
        appURL = local.includes(':') || local.includes('.') ? `http://${local}` : `http://localhost:${local}`;
      }
    }

    this.callback(null, {
      statusCode: 302,
      headers: {
        Location: `${appURL}/auth?token=${token}`
      }
    });
  }

  private async loadConfigurations(): Promise<Configurations> {
    if (!DDB_TABLES.configurations) {
      return new Configurations({ PK: Configurations.PK });
    }
    try {
      const data = await ddb.get({ TableName: DDB_TABLES.configurations, Key: { PK: Configurations.PK } });
      return new Configurations(data);
    } catch {
      return new Configurations({ PK: Configurations.PK });
    }
  }

  private async loadOrInitConfigurations(firstAdminId: string): Promise<Configurations> {
    if (!DDB_TABLES.configurations) {
      return new Configurations({ PK: Configurations.PK, administratorsIds: [firstAdminId] });
    }

    try {
      return new Configurations(
        await ddb.get({ TableName: DDB_TABLES.configurations, Key: { PK: Configurations.PK } })
      );
    } catch (err: any) {
      if (String(err).includes('Not found') || err?.name === 'ResourceNotFoundException') {
        const configurations = new Configurations({
          PK: Configurations.PK,
          administratorsIds: [firstAdminId],
          updatedAt: new Date().toISOString()
        });
        try {
          await ddb.put({
            TableName: DDB_TABLES.configurations,
            Item: JSON.parse(JSON.stringify(configurations)),
            ConditionExpression: 'attribute_not_exists(PK)'
          });
        } catch {
          // If already created concurrently, continue
        }
        return configurations;
      }
      throw new HandledError('Error loading configuration');
    }
  }
}

const getJwtSecret = async (): Promise<string> => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (!JWT_SECRET) JWT_SECRET = await systemsManager.getSecretByName(SECRETS_PATH);
  return JWT_SECRET;
};
