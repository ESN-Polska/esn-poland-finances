import { HandledError, ResourceController } from 'idea-aws';

import {
  getCachedGitHubContributors,
  GitHubContributor,
  refreshGitHubContributors
} from '../services/githubContributors';

export const handler = (ev: any, _: any, cb: any): Promise<void> => new ContributorsRC(ev, cb).handleRequest();

class ContributorsRC extends ResourceController {
  protected async getResources(): Promise<GitHubContributor[]> {
    const cached = await getCachedGitHubContributors();
    if (cached) return cached;

    try {
      return await refreshGitHubContributors();
    } catch (error) {
      this.logger.error('Unable to refresh GitHub contributors', error);
      throw new HandledError('Contributors are currently unavailable');
    }
  }
}
