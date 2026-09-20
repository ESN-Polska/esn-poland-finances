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

export const handler = async (event: APIGatewayProxyEventV2): Promise<HTTPAuthResult> => {
  const authorization = event?.headers?.authorization || event?.headers?.Authorization;
  const result: HTTPAuthResult = { isAuthorized: false };

  if (!authorization) {
    return result;
  }

  const user = await verifyTokenAndGetUser(authorization);
  if (user) {
    await verifyUserPermissions(user);
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

const verifyTokenAndGetUser = async (rawHeader: string): Promise<User | null> => {
  try {
    const token = rawHeader.startsWith('Bearer ') ? rawHeader.slice(7) : rawHeader;
    const secret = await getJwtSecret();
    const payload = verify(token, secret) as JwtPayload;
    return new User(payload);
  } catch {
    return null;
  }
};

const verifyUserPermissions = async (user: User): Promise<void> => {
  if (!DDB_TABLES.configurations) return;
  try {
    const configData = await ddb.get({
      TableName: DDB_TABLES.configurations,
      Key: { PK: Configurations.PK }
    });
    if (configData) {
      const configurations = new Configurations(configData);
      User.applyConfigurationPermissions(user, configurations);
    }
  } catch {
    // If configurations table cannot be read, preserve user attributes
  }
};
