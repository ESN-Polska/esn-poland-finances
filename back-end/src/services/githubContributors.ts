import axios, { AxiosResponse } from 'axios';
import { DynamoDB } from 'idea-aws';

export interface GitHubContributor {
  login: string;
  html_url: string;
  avatar_url: string;
  contributions: number;
  name: string | null;
}

const REPOSITORY = 'ESN-Polska/esn-poland-finances';
const CONTRIBUTORS_URL = `https://api.github.com/repos/${REPOSITORY}/contributors?per_page=100`;
const DDB_TABLE = process.env.DDB_TABLE_contributors;
const CACHE_KEY = 'contributors';
const MAX_RETRIES = 3;
const ddb = new DynamoDB();

interface ContributorsCache {
  contributors: GitHubContributor[];
  etag?: string;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function getFromGitHub<T>(url: string, headers: Record<string, string> = {}): Promise<AxiosResponse<T>> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await axios.get<T>(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'ESN-Poland-Finances-Backend',
          ...headers
        },
        validateStatus: status => status === 304 || (status >= 200 && status < 300)
      });
    } catch (error: any) {
      const status = error.response?.status;
      const shouldRetry = status === 429 || status >= 500;
      if (!shouldRetry || attempt >= MAX_RETRIES) throw error;

      const retryAfter = Number(error.response?.headers?.['retry-after']);
      await wait(Number.isFinite(retryAfter) ? retryAfter * 1000 : 500 * 2 ** attempt);
    }
  }
}

async function getAllContributors(etag?: string): Promise<{ contributors: GitHubContributor[]; etag?: string; notModified: boolean }> {
  const contributors: GitHubContributor[] = [];
  let nextURL: string | null = CONTRIBUTORS_URL;
  let firstResponse = true;
  let currentETag: string | undefined;

  while (nextURL) {
    const response: AxiosResponse<any[]> = await getFromGitHub<any[]>(nextURL, firstResponse && etag ? { 'If-None-Match': etag } : {});
    if (firstResponse && response.status === 304) return { contributors: [], etag, notModified: true };
    if (firstResponse) currentETag = response.headers?.etag as string | undefined;
    firstResponse = false;
    const users = (response.data || []).filter(contributor => contributor.type === 'User');
    const profiles = await Promise.all(
      users.map(async contributor => {
        try {
          const profile = await getFromGitHub<{ name: string | null }>(
            `https://api.github.com/users/${encodeURIComponent(contributor.login)}`
          );
          return { ...contributor, name: profile.data.name };
        } catch (_) {
          return { ...contributor, name: null };
        }
      })
    );
    contributors.push(...profiles);

    const linkHeader = response.headers?.link as string | undefined;
    nextURL = linkHeader?.match(/<([^>]+)>; rel="next"/)?.[1] ?? null;
  }

  return {
    contributors: contributors.map(({ login, html_url, avatar_url, contributions, name }) => ({
      login,
      html_url,
      avatar_url,
      contributions,
      name
    })),
    etag: currentETag,
    notModified: false
  };
}

export async function refreshGitHubContributors(): Promise<GitHubContributor[]> {
  const cached = await getCachedContributorsCache();
  const result = await getAllContributors(cached?.etag);
  if (result.notModified && cached) return cached.contributors;
  if (!result.contributors.length) throw new Error('GitHub returned an empty contributor list');

  if (DDB_TABLE) {
    await ddb.put({
      TableName: DDB_TABLE,
      Item: {
        PK: CACHE_KEY,
        contributors: result.contributors,
        etag: result.etag,
        updatedAt: new Date().toISOString()
      }
    });
  }
  return result.contributors;
}

export async function getCachedGitHubContributors(): Promise<GitHubContributor[] | null> {
  const cached = await getCachedContributorsCache();
  return cached?.contributors ?? null;
}

async function getCachedContributorsCache(): Promise<ContributorsCache | null> {
  if (!DDB_TABLE) return null;
  try {
    const cached = await ddb.get({ TableName: DDB_TABLE, Key: { PK: CACHE_KEY } });
    return cached?.contributors ? { contributors: cached.contributors, etag: cached.etag } : null;
  } catch (_) {
    return null;
  }
}
