import { DynamoDB, HandledError, ResourceController, S3 } from 'idea-aws';
import { SignedURL } from 'idea-toolbox';
import { User } from '../models/user.model';

const PROJECT = process.env.PROJECT || 'esn-poland-finances';
const S3_BUCKET_MEDIA = process.env.S3_BUCKET_MEDIA || `${PROJECT}-media`;
const S3_IMAGES_FOLDER = process.env.S3_IMAGES_FOLDER || `images/${process.env.STAGE || 'dev'}`;

const ddb = new DynamoDB();
const s3 = new S3();

export const handler = (ev: any, _: any, cb: any): Promise<void> => new MediaRC(ev, cb).handleRequest();

class MediaRC extends ResourceController {
  user: User;

  constructor(event: any, callback: any) {
    super(event, callback);
    this.user = event.requestContext?.authorizer?.lambda?.user
      ? new User(event.requestContext.authorizer.lambda.user)
      : (null as any);
  }

  protected async checkAuthBeforeRequest(): Promise<void> {
    if (
      !this.user ||
      (!this.user.isAdministrator &&
        !this.user.hasPermission('configurations.options') &&
        !this.user.hasPermission('rules.update'))
    ) {
      throw new HandledError('Unauthorized');
    }
  }

  protected async postResources(): Promise<SignedURL> {
    const isDocument = this.body?.type === 'document';
    const ext = this.body?.extension?.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || (isDocument ? 'pdf' : 'png');
    if (isDocument && ext !== 'pdf') {
      throw new HandledError('Only PDF files are allowed for documents');
    }
    const folder = isDocument ? `documents/${process.env.STAGE || 'dev'}` : S3_IMAGES_FOLDER;
    const mediaId = await ddb.IUNID(`${PROJECT}-media`);
    const key = `${folder}/${mediaId}.${ext}`;
    const signedURL = await s3.signedURLPut(S3_BUCKET_MEDIA, key);
    signedURL.id = mediaId;
    (signedURL as any).key = key;
    (signedURL as any).cdnUrl = `https://${process.env.MEDIA_DOMAIN || 'media.finances.esn-poland.link'}/${key}`;
    return signedURL;
  }
}
