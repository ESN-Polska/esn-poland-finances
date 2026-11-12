import { default as Axios } from 'axios';
import { sign } from 'jsonwebtoken';
import { DynamoDB, HandledError, ResourceController, SystemsManager, S3 } from 'idea-aws';

import { User, UserMembershipGroup } from '../models/user.model';
import { Configurations } from '../models/configurations.model';
import { findCountryMatch, resolveCountriesForSections } from '../services/esnCountries';

const OAUTH_TOKEN_URL = 'https://accounts.esn.org/oauth/token';
const OAUTH_USERINFO_URL = 'https://accounts.esn.org/oauth/v2/userinfo';
const JWT_EXPIRE_TIME = '7 days';

const PROJECT = process.env.PROJECT || 'esn-poland-finances';
const APP_DOMAIN = process.env.APP_DOMAIN || 'finances.esn.pl';
const APP_URL = `https://${APP_DOMAIN}`;
const MEDIA_DOMAIN = process.env.MEDIA_DOMAIN || 'media.finances.esn-poland.link';
const S3_BUCKET_MEDIA = process.env.S3_BUCKET_MEDIA || `${PROJECT}-media`;

const DDB_TABLES = {
  configurations: process.env.DDB_TABLE_configurations,
  users: process.env.DDB_TABLE_users
};
const ddb = new DynamoDB();
const s3 = new S3();

const SECRETS_PATH = `/${PROJECT}/auth`;
const systemsManager = new SystemsManager();

let JWT_SECRET: string;

function isLocalHost(hostOrUrl?: string | null): boolean {
  if (!hostOrUrl) return false;
  return (
    hostOrUrl.includes('localhost') ||
    hostOrUrl.includes('127.0.0.1') ||
    /192\.168\.\d{1,3}\.\d{1,3}/.test(hostOrUrl) ||
    /10\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(hostOrUrl) ||
    /172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}/.test(hostOrUrl)
  );
}

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
    const isLocalOrigin = isLocalHost(origin);
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
    const isLocalOrigin = isLocalHost(origin);
    const defaultRedirectUri = (!isLocalOrigin && origin) ? `${origin.replace(/\/+$/, '')}/auth` : `${APP_URL}/auth`;
    const effectiveRedirectUri = (redirectUri && !isLocalHost(redirectUri)) ? redirectUri : defaultRedirectUri;

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

    const userId = userInfo.sub ? String(userInfo.sub).trim().toLowerCase() : '';
    const rawNickname = userInfo.legacy_sub || userInfo.nickname || userInfo.preferred_username || userInfo.username || userId;
    const nickname = rawNickname ? String(rawNickname).toLowerCase().trim() : userId;
    const rawPref = userInfo.preferred_username || userInfo.username || rawNickname || userId;
    const preferredUsername = rawPref ? String(rawPref).toLowerCase().trim() : nickname;

    if (!userId) {
      this.logger.error('Missing user identity from OAuth userinfo', { userInfo });
      throw new HandledError('Missing user identity from ESN Accounts');
    }

    const configurations = await this.loadOrInitConfigurations(userId);

    const email = userInfo.esn_email || userInfo.email || '';
    const firstName = userInfo.given_name || '';
    const lastName = userInfo.family_name || '';

    let existingUserRecord: any = null;
    if (DDB_TABLES.users) {
      try {
        existingUserRecord = await ddb.get({ TableName: DDB_TABLES.users, Key: { userId } });
        if (!existingUserRecord) {
          const candidateKeys = [nickname, preferredUsername].filter(k => k && k !== userId);
          for (const key of candidateKeys) {
            const legacy = await ddb.get({ TableName: DDB_TABLES.users, Key: { userId: key } }).catch(() => null);
            if (legacy) {
              existingUserRecord = legacy;
              break;
            }
          }
        }
      } catch {}
    }

    const detailedGroups: any[] = Array.isArray(userInfo.detailed_groups)
      ? userInfo.detailed_groups
      : typeof userInfo.detailed_groups === 'object' && userInfo.detailed_groups !== null
      ? Object.values(userInfo.detailed_groups)
      : [];

    const availableSections: UserMembershipGroup[] = detailedGroups
      .filter((g: any) => String(g?.type || '').toLowerCase() === 'section')
      .map((g: any) => ({
        code: String(g?.scope || '').trim(),
        name: String(g?.label || g?.name || g?.scope || '').trim()
      }))
      .filter(s => s.code || s.name);

    const uniqueSections = availableSections.filter(
      (s, idx, self) => self.findIndex(o => (o.code && o.code === s.code) || (o.name && o.name === s.name)) === idx
    );

    const availableCountries: UserMembershipGroup[] = detailedGroups
      .filter((g: any) => String(g?.type || '').toLowerCase() === 'country')
      .map((g: any) => ({
        code: String(g?.scope || '').trim(),
        name: String(g?.label || g?.name || g?.scope || '').trim()
      }))
      .filter(c => c.code || c.name);

    let uniqueCountries = availableCountries.filter(
      (c, idx, self) => self.findIndex(o => (o.code && o.code === c.code) || (o.name && o.name === c.name)) === idx
    );

    // If OAuth response has no matching country for a section (e.g. user only has section membership),
    // treat https://accounts.esn.org/api/v2/countries as countries library to resolve section countries.
    uniqueCountries = await resolveCountriesForSections(uniqueSections, uniqueCountries);

    // If user has a previously chosen section preference in DB that is still valid, retain it; otherwise default to first
    let primarySection = uniqueSections[0];
    let isChosenSectionStillValid = false;
    if (existingUserRecord?.sectionCode || existingUserRecord?.section) {
      const match = uniqueSections.find(
        s => (existingUserRecord.sectionCode && s.code === existingUserRecord.sectionCode) ||
             (existingUserRecord.section && s.name === existingUserRecord.section)
      );
      if (match) {
        primarySection = match;
        isChosenSectionStillValid = true;
      }
    }

    // If user has a previously chosen country preference in DB that is still valid, retain it; otherwise default to first
    let primaryCountry = uniqueCountries[0];
    if (existingUserRecord?.country) {
      const match = uniqueCountries.find(
        c => c.name === existingUserRecord.country || c.code === existingUserRecord.country
      );
      if (match) {
        primaryCountry = match;
      }
    }

    // Align primaryCountry with primarySection's prefix if available
    const sectionPrefix = primarySection?.code ? primarySection.code.split('-')[0]?.toUpperCase().trim() : '';
    if (sectionPrefix && uniqueCountries.length > 0) {
      const match = findCountryMatch(sectionPrefix, uniqueCountries);
      if (match) {
        primaryCountry = match;
      }
    }

    const sectionCode = primarySection?.code || existingUserRecord?.sectionCode || '';
    const section = primarySection?.name || existingUserRecord?.section || '';
    const country = primaryCountry?.name || existingUserRecord?.country || '';

    const incomingExternalAvatar = (typeof userInfo.picture === 'string' ? userInfo.picture.trim() : '') ||
      (typeof userInfo.avatar === 'string' ? userInfo.avatar.trim() : '') ||
      (typeof userInfo.avatar_url === 'string' ? userInfo.avatar_url.trim() : '') || '';

    const { avatarURL, externalAvatarURL } = await this.syncUserProfilePicture(
      userId,
      incomingExternalAvatar,
      existingUserRecord,
      accessToken
    );

    this.logger.info('Extracted user attributes from OAuth profile', {
      userId,
      email,
      sectionCode,
      section,
      country,
      avatarURL,
      externalAvatarURL,
      availableSectionsCount: uniqueSections.length,
      availableCountriesCount: uniqueCountries.length
    });

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
      nickname: nickname || existingUserRecord?.nickname || userId,
      preferredUsername: preferredUsername || existingUserRecord?.preferredUsername || nickname || userId,
      email,
      sectionCode,
      firstName,
      lastName,
      roles: extractedRoles,
      extendedRoles: extractedRoles,
      section,
      country,
      availableSections: uniqueSections,
      availableCountries: uniqueCountries,
      avatarURL,
      externalAvatarURL,
      lastLoginAt: new Date().toISOString(),
      isAdministrator: false,
      disabledEmailNotifications: existingUserRecord?.disabledEmailNotifications || [],
      primarySectionChosen: isChosenSectionStillValid
        ? (existingUserRecord?.primarySectionChosen ?? (uniqueSections.length <= 1))
        : (uniqueSections.length <= 1),
      defaultBankDetails: existingUserRecord?.defaultBankDetails
    });
    User.applyConfigurationPermissions(user, configurations);
    this.logger.info('ESN Accounts OAuth login successful', { userId: user.userId, nickname: user.nickname, section: user.sectionCode });

    if ((configurations.blockedUserIds || []).some((b: string) => {
      const clean = b.toLowerCase();
      return user.userId.toLowerCase() === clean ||
        (user.nickname && user.nickname.toLowerCase() === clean) ||
        (user.preferredUsername && user.preferredUsername.toLowerCase() === clean);
    })) {
      this.logger.warn('Login rejected: user account is suspended', { userId: user.userId });
      const acceptsJson = (this.event.headers?.accept || '').includes('application/json');
      if (this.httpMethod === 'POST' || (acceptsJson && !this.queryParams?.redirect)) {
        this.returnStatusCode = 403;
        throw new HandledError('Your account has been suspended. Please contact the administrator.');
      }
      this.callback(null, {
        statusCode: 302,
        headers: {
          Location: `${APP_URL}/auth?error=user_suspended`
        }
      });
      return;
    }

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
            nickname: user.nickname || '',
            preferredUsername: user.preferredUsername || '',
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            name: user.getDisplayName(),
            section: user.section,
            sectionCode: user.sectionCode,
            country: user.country,
            availableSections: user.availableSections || [],
            availableCountries: user.availableCountries || [],
            avatarURL: user.avatarURL,
            externalAvatarURL: user.externalAvatarURL || '',
            roles: user.roles,
            extendedRoles: user.extendedRoles,
            isAdministrator: user.isAdministrator,
            canManageFinances: user.canManageFinances,
            lastLoginAt: user.lastLoginAt,
            disabledEmailNotifications: user.disabledEmailNotifications || [],
            primarySectionChosen: user.primarySectionChosen,
            ...(user.defaultBankDetails ? { defaultBankDetails: user.defaultBankDetails } : {})
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
    const guestUserId = `guest_${shortId}`;
    let existingGuestRecord: any = null;
    if (DDB_TABLES.users) {
      try {
        existingGuestRecord = await ddb.get({ TableName: DDB_TABLES.users, Key: { userId: guestUserId } });
      } catch {}
    }

    const guestUser = new User({
      userId: guestUserId,
      nickname: guestUserId,
      preferredUsername: guestUserId,
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
      lastLoginAt: now,
      disabledEmailNotifications: existingGuestRecord?.disabledEmailNotifications || [],
      defaultBankDetails: existingGuestRecord?.defaultBankDetails
    });

    // Persist guest user to DynamoDB users table
    if (DDB_TABLES.users) {
      try {
        await ddb.put({
          TableName: DDB_TABLES.users,
          Item: {
            userId: guestUser.userId,
            nickname: guestUser.nickname,
            preferredUsername: guestUser.preferredUsername,
            email: guestUser.email,
            firstName: guestUser.firstName,
            lastName: '',
            name: guestUser.getDisplayName(),
            section: '',
            sectionCode: '',
            country: '',
            avatarURL: '',
            externalAvatarURL: '',
            roles: guestUser.roles,
            extendedRoles: guestUser.extendedRoles,
            isAdministrator: false,
            canManageFinances: false,
            isGuest: true,
            guestInvitationId: guestUser.guestInvitationId,
            guestPurpose: guestUser.guestPurpose,
            guestPosition: guestUser.guestPosition,
            guestDefaultSourceOfFunding: guestUser.guestDefaultSourceOfFunding,
            lastLoginAt: guestUser.lastLoginAt,
            disabledEmailNotifications: guestUser.disabledEmailNotifications || [],
            ...(guestUser.defaultBankDetails ? { defaultBankDetails: guestUser.defaultBankDetails } : {})
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
      const isLocal =
        /^\d+$/.test(local) ||
        isLocalHost(local);

      if (isLocal) {
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

  private isOurCdnAvatar(url?: string | null): boolean {
    if (!url || typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      const mediaDomain = process.env.MEDIA_DOMAIN || MEDIA_DOMAIN;
      const hostname = parsed.hostname.toLowerCase();
      if (
        hostname === mediaDomain.toLowerCase() ||
        hostname.endsWith('.finances.esn-poland.link') ||
        hostname.endsWith('.finances.esn.pl')
      ) {
        return true;
      }
      const bucket = (process.env.S3_BUCKET_MEDIA || S3_BUCKET_MEDIA).toLowerCase();
      if (hostname.includes(bucket) || parsed.pathname.toLowerCase().includes(bucket)) {
        return true;
      }
    } catch {
      if (url.startsWith('/avatars/') || url.startsWith('avatars/')) return true;
    }
    return false;
  }

  private async deleteS3Avatar(fileUrl?: string): Promise<void> {
    if (!fileUrl) return;
    try {
      let key = '';
      if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
        if (!this.isOurCdnAvatar(fileUrl)) return;
        const url = new URL(fileUrl);
        key = url.pathname.replace(/^\/+/, '');
      } else if (fileUrl.startsWith('avatars/') || fileUrl.startsWith('/avatars/')) {
        key = fileUrl.replace(/^\/+/, '');
      }
      if (key && key.startsWith('avatars/')) {
        await s3.deleteObject({ bucket: S3_BUCKET_MEDIA, key });
        this.logger.info('Deleted old avatar from S3', { key });
      }
    } catch (err: any) {
      this.logger.warn('Failed to delete old avatar from S3', { fileUrl, err: err?.message || err });
    }
  }

  private getAvatarCandidateUrls(rawUrl: string): string[] {
    const candidates: string[] = [];
    if (!rawUrl || typeof rawUrl !== 'string') return candidates;

    try {
      let fullUrl = rawUrl.trim();
      if (fullUrl.startsWith('//')) {
        fullUrl = `https:${fullUrl}`;
      } else if (fullUrl.startsWith('/')) {
        fullUrl = `https://accounts.esn.org${fullUrl}`;
      }

      const parsed = new URL(fullUrl);
      const pathname = parsed.pathname;

      // When OAuth/CAS provides the default (non-styled) URL, Drupal stores the raw upload privately in S3 (403 Forbidden),
      // while the public rendered image is generated and stored under image styles (such as user_block).
      const avatarMatch = pathname.match(/(?:^|\/)(accounts\/avatars\/.+)$/);
      if (avatarMatch && !pathname.includes('/styles/')) {
        const avatarPath = avatarMatch[1]; // e.g. 'accounts/avatars/2026-07/uuid.jpg'
        const hosts = Array.from(new Set([parsed.host, 'esn-images-prod.s3.eu-west-1.amazonaws.com']));
        const styles = ['user_block', 'thumbnail', 'medium'];

        for (const host of hosts) {
          for (const style of styles) {
            // Drupal user_block image style converts images and appends .png (e.g. uuid.jpg.png)
            candidates.push(`https://${host}/styles/${style}/s3/${avatarPath}.png`);
            // Preserving original extension
            candidates.push(`https://${host}/styles/${style}/s3/${avatarPath}`);
            // Replacing extension with .png
            const withoutExt = avatarPath.replace(/\.[^/.]+$/, '');
            candidates.push(`https://${host}/styles/${style}/s3/${withoutExt}.png`);
            // Standard public files path fallback
            candidates.push(`https://${host}/sites/default/files/styles/${style}/public/${avatarPath}`);
          }
        }
      }

      // Include clean URL without query parameters
      const cleanUrl = `${parsed.origin}${parsed.pathname}`;
      if (!candidates.includes(cleanUrl)) {
        candidates.push(cleanUrl);
      }

      // Include original full URL
      if (!candidates.includes(fullUrl)) {
        candidates.push(fullUrl);
      }
    } catch {
      candidates.push(rawUrl);
    }

    return candidates;
  }

  private async downloadAvatar(
    avatarUrl: string,
    accessToken?: string
  ): Promise<{ buffer: Buffer; ext: string; mimeType: string } | null> {
    const candidateUrls = this.getAvatarCandidateUrls(avatarUrl);
    if (candidateUrls.length === 0) return null;

    let response: any;
    let successfulUrl: string = '';

    for (const url of candidateUrls) {
      try {
        const headers: Record<string, string> = {
          'User-Agent': 'ESN-Poland-Finances/1.0',
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        };
        if (accessToken && url.includes('accounts.esn.org')) {
          headers['Authorization'] = `Bearer ${accessToken}`;
        }

        try {
          response = await Axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 8000,
            headers
          });
        } catch (authErr: any) {
          if (headers['Authorization']) {
            delete headers['Authorization'];
            response = await Axios.get(url, {
              responseType: 'arraybuffer',
              timeout: 8000,
              headers
            });
          } else {
            throw authErr;
          }
        }

        if (response && response.status === 200 && response.data && response.data.length > 0) {
          successfulUrl = url;
          break;
        }
      } catch {
        // Try next candidate URL
      }
    }

    if (!response || !response.data || response.data.length === 0) {
      this.logger.warn('Failed to download avatar from all candidate URLs', { avatarUrl, candidateCount: candidateUrls.length });
      return null;
    }

    this.logger.info('Successfully downloaded avatar from candidate URL', { successfulUrl });
    const buffer = Buffer.from(response.data);
    const contentType = (response.headers?.['content-type'] || response.headers?.['Content-Type'] || '').toLowerCase();
    let ext = 'jpg';
    let mimeType = 'image/jpeg';

    if (contentType.includes('png') || (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47)) {
      ext = 'png';
      mimeType = 'image/png';
    } else if (contentType.includes('webp') || (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP')) {
      ext = 'webp';
      mimeType = 'image/webp';
    } else if (contentType.includes('gif') || buffer.subarray(0, 4).toString() === 'GIF8') {
      ext = 'gif';
      mimeType = 'image/gif';
    } else if (contentType.includes('svg')) {
      ext = 'svg';
      mimeType = 'image/svg+xml';
    } else if (contentType.includes('jpeg') || contentType.includes('jpg') || (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)) {
      ext = 'jpg';
      mimeType = 'image/jpeg';
    } else {
      try {
        const parsed = new URL(successfulUrl || avatarUrl);
        const match = parsed.pathname.match(/\.(jpe?g|png|webp|gif|svg)$/i);
        if (match) {
          const matchedExt = match[1].toLowerCase();
          if (matchedExt === 'jpeg' || matchedExt === 'jpg') {
            ext = 'jpg';
            mimeType = 'image/jpeg';
          } else if (matchedExt === 'png') {
            ext = 'png';
            mimeType = 'image/png';
          } else if (matchedExt === 'webp') {
            ext = 'webp';
            mimeType = 'image/webp';
          } else if (matchedExt === 'gif') {
            ext = 'gif';
            mimeType = 'image/gif';
          } else if (matchedExt === 'svg') {
            ext = 'svg';
            mimeType = 'image/svg+xml';
          }
        }
      } catch {}
    }

    return { buffer, ext, mimeType };
  }

  private async syncUserProfilePicture(
    userId: string,
    incomingExternalUrl: string,
    existingUserRecord: any,
    accessToken?: string
  ): Promise<{ avatarURL: string; externalAvatarURL: string }> {
    const stage = this.stage || process.env.STAGE || 'dev';
    const mediaDomain = process.env.MEDIA_DOMAIN || MEDIA_DOMAIN;
    const previousStoredAvatar: string = existingUserRecord?.avatarURL || '';
    const previousExternalAvatar: string =
      existingUserRecord?.externalAvatarURL ||
      (!this.isOurCdnAvatar(previousStoredAvatar) ? previousStoredAvatar : '') ||
      '';

    let cleanIncoming = (incomingExternalUrl || '').trim();
    if (cleanIncoming.startsWith('//')) {
      cleanIncoming = `https:${cleanIncoming}`;
    } else if (cleanIncoming.startsWith('/')) {
      cleanIncoming = `https://accounts.esn.org${cleanIncoming}`;
    }

    // Case 1: User has no external avatar now
    if (!cleanIncoming) {
      if (previousStoredAvatar && this.isOurCdnAvatar(previousStoredAvatar)) {
        await this.deleteS3Avatar(previousStoredAvatar);
      }
      return { avatarURL: '', externalAvatarURL: '' };
    }

    // Case 2: External URL has not changed and image is already stored in our S3
    const isAlreadyStoredInS3 = this.isOurCdnAvatar(previousStoredAvatar);
    if (cleanIncoming === previousExternalAvatar && isAlreadyStoredInS3) {
      this.logger.info('User avatar URL unchanged, keeping stored S3 avatar', {
        userId,
        avatarURL: previousStoredAvatar
      });
      return { avatarURL: previousStoredAvatar, externalAvatarURL: cleanIncoming };
    }

    // Case 3: URL changed OR external avatar has never been saved to our S3 yet
    this.logger.info('Refreshing user avatar in S3', {
      userId,
      incomingUrl: cleanIncoming,
      previousExternalUrl: previousExternalAvatar,
      isAlreadyStoredInS3
    });

    const downloaded = await this.downloadAvatar(cleanIncoming, accessToken);
    if (!downloaded) {
      this.logger.warn('Could not download avatar, falling back to existing or external URL', { userId });
      return {
        avatarURL: previousStoredAvatar || cleanIncoming,
        externalAvatarURL: previousExternalAvatar || cleanIncoming
      };
    }

    try {
      const cleanUserId = (userId || 'user').replace(/[^a-zA-Z0-9_-]/g, '_');
      const timestamp = Date.now();
      const key = `avatars/${stage}/${cleanUserId}_${timestamp}.${downloaded.ext}`;

      await s3.putObject({
        bucket: S3_BUCKET_MEDIA,
        key,
        body: downloaded.buffer,
        contentType: downloaded.mimeType
      });

      const newAvatarURL = `https://${mediaDomain}/${key}`;
      this.logger.info('User avatar successfully stored in S3', { userId, key, newAvatarURL });

      // Clean up previous S3 avatar file if present
      if (previousStoredAvatar && isAlreadyStoredInS3 && previousStoredAvatar !== newAvatarURL) {
        await this.deleteS3Avatar(previousStoredAvatar);
      }

      return { avatarURL: newAvatarURL, externalAvatarURL: cleanIncoming };
    } catch (s3Err: any) {
      this.logger.error('Failed to upload user avatar to S3', { userId, error: s3Err?.message || s3Err });
      return {
        avatarURL: previousStoredAvatar || cleanIncoming,
        externalAvatarURL: previousExternalAvatar || cleanIncoming
      };
    }
  }
}

const getJwtSecret = async (): Promise<string> => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (!JWT_SECRET) JWT_SECRET = await systemsManager.getSecretByName(SECRETS_PATH);
  return JWT_SECRET;
};
