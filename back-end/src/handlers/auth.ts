import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { JwtPayload, verify } from 'jsonwebtoken';
import { DynamoDB, SystemsManager } from 'idea-aws';

import { User } from '../models/user.model';
import { Configurations } from '../models/configurations.model';

const PROJECT = process.env.PROJECT || 'esn-poland-finances';
const DDB_TABLES = {
  configurations: process.env.DDB_TABLE_configurations
};
const ddb = new DynamoDB();

const SECRETS_PATH = `/${PROJECT}/auth`;
const systemsManager = new SystemsManager();

let JWT_SECRET: string;

interface HTTPAuthResult {
  isAuthorized: boolean;
  context?: {
    principalId: string;
    user: any;
  };
}

interface TokenUser extends User {
  iat?: number;
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<HTTPAuthResult> => {
  const authorization = event?.headers?.authorization || event?.headers?.Authorization;
  const result: HTTPAuthResult = { isAuthorized: false };

  if (!authorization) {
    return result;
  }

  const user = await verifyTokenAndGetUser(authorization);
  if (user) {
    const configurations = await verifyUserPermissions(user);
    if (configurations) {
      // If the app is currently locked, non-administrators are not authorized
      if (configurations.appLocked && !user.isAdministrator) {
        return result;
      }
      // If the app was locked after this token was issued, the non-administrator session has been revoked
      if (configurations.appLockedAt && !user.isAdministrator && user.iat) {
        const lockedAtEpoch = Math.floor(new Date(configurations.appLockedAt).getTime() / 1000);
        if (user.iat < lockedAtEpoch) {
          return result;
        }
      }
    }

    result.isAuthorized = true;
    result.context = {
      principalId: user.userId,
      user: JSON.parse(JSON.stringify(user))
    };
  }

  return result;
};

const getJwtSecret = async (): Promise<string> => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (!JWT_SECRET) JWT_SECRET = await systemsManager.getSecretByName(SECRETS_PATH);
  return JWT_SECRET;
};

const verifyTokenAndGetUser = async (rawHeader: string): Promise<TokenUser | null> => {
  try {
    const token = rawHeader.startsWith('Bearer ') ? rawHeader.slice(7) : rawHeader;
    const secret = await getJwtSecret();
    const payload = verify(token, secret) as JwtPayload;
    const user = new User(payload) as TokenUser;
    user.iat = typeof payload.iat === 'number' ? payload.iat : undefined;
    return user;
  } catch {
    return null;
  }
};

const verifyUserPermissions = async (user: User): Promise<Configurations | null> => {
  if (!DDB_TABLES.configurations) return null;
  try {
    const configData = await ddb.get({
      TableName: DDB_TABLES.configurations,
      Key: { PK: Configurations.PK }
    });
    if (configData) {
      const configurations = new Configurations(configData);
      User.applyConfigurationPermissions(user, configurations);
      return configurations;
    }
  } catch {
    // If configurations table cannot be read, preserve user attributes
  }
  return null;
};
