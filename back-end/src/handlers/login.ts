import { default as Axios } from 'axios';
import { parseStringPromise } from 'xml2js';
import { sign } from 'jsonwebtoken';
import { DynamoDB, HandledError, ResourceController, SystemsManager } from 'idea-aws';

import { User } from '../models/user.model';
import { Configurations } from '../models/configurations.model';

const CAS_URL = 'https://accounts.esn.org/cas';
const JWT_EXPIRE_TIME = '7 days';

const PROJECT = process.env.PROJECT || 'esn-poland-finances';
const APP_DOMAIN = process.env.APP_DOMAIN || 'finances.esn-poland.link';
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
    const ticket = this.queryParams?.ticket;
    if (!ticket) {
      throw new HandledError('Missing ticket parameter');
    }

    try {
      // Build CAS service validation URL
      const localhost = this.queryParams.localhost ? `?localhost=${this.queryParams.localhost}` : '';
      const serviceURL = this.queryParams.service || `https://${this.host}/${this.stage}/login${localhost}`;
      const validationURL = `${CAS_URL}/serviceValidate?service=${encodeURIComponent(serviceURL)}&ticket=${encodeURIComponent(ticket)}`;

      const ticketValidation = await Axios.get(validationURL);
      const jsonWithUserData = await parseStringPromise(ticketValidation.data);
      this.logger.debug('CAS ticket validated and parsed', { ticket: jsonWithUserData });

      const success = !!jsonWithUserData?.['cas:serviceResponse']?.['cas:authenticationSuccess'];
      if (!success) {
        this.logger.warn('CAS ticket validation unsuccessful', { response: ticketValidation.data });
        throw new HandledError('Login failed');
      }

      const data = jsonWithUserData['cas:serviceResponse']['cas:authenticationSuccess'][0];
      const attributes = data['cas:attributes']?.[0] || {};
      const userId = String(data['cas:user']?.[0] || '').toLowerCase();

      if (!userId) {
        throw new HandledError('Missing user identity from CAS');
      }

      const configurations = await this.loadOrInitConfigurations(userId);

      const user = new User({
        userId,
        email: attributes['cas:mail']?.[0] || '',
        sectionCode: attributes['cas:sc']?.[0] || '',
        firstName: attributes['cas:first']?.[0] || '',
        lastName: attributes['cas:last']?.[0] || '',
        roles: attributes['cas:roles'] || [],
        extendedRoles: attributes['cas:extended_roles'] || [],
        section: attributes['cas:section']?.[0] || '',
        country: attributes['cas:country']?.[0] || '',
        avatarURL: attributes['cas:picture']?.[0] || '',
        lastLoginAt: new Date().toISOString(),
        isAdministrator: false
      });
      User.applyConfigurationPermissions(user, configurations);
      this.logger.info('ESN Accounts login successful', { userId: user.userId, section: user.sectionCode });

      // Persist user to DynamoDB
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

      // Return JSON if caller explicitly requested application/json and not redirecting
      const acceptsJson = (this.event.headers?.accept || '').includes('application/json');
      if (acceptsJson && !this.queryParams.redirect) {
        return { token, user: userData };
      }

      // Default browser redirect to the front-end with token
      let appURL = APP_URL;
      if (this.queryParams.localhost) {
        const local = String(this.queryParams.localhost);
        const isLocalHost =
          /^\d+$/.test(local) ||
          /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(local) ||
          /^192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(local) ||
          /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(local) ||
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
    } catch (err) {
      this.logger.error('CAS validation error', err);
      throw new HandledError('Login failed');
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
