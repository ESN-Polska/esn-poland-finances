import { GenericController, HandledError } from 'idea-aws';

import { refreshGitHubContributors } from '../services/githubContributors';

export const handler = async (ev: any, _: any, cb: any): Promise<void> =>
  await new RefreshContributors(ev, cb).handleRequest();

class RefreshContributors extends GenericController {
  async handleRequest(): Promise<void> {
    try {
      await refreshGitHubContributors();
      this.done(null);
    } catch (error) {
      this.logger.error('Failed to refresh GitHub contributors', error);
      this.done(new HandledError('GITHUB CONTRIBUTORS REFRESH FAILED'));
    }
  }
}
