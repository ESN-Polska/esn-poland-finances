import axios from 'axios';
import { environment } from '../environments/environment';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  sectionCode?: string;
  roles: string[];
}

const rawApiUrl = import.meta.env.VITE_API_URL || (environment.api.url ? `https://${environment.api.url}` : '');
const API_BASE_URL = rawApiUrl;

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  },
  timeout: 10000
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const authApi = {
  async loginCAS(ticket: string, service: string): Promise<{ token: string; user: AuthenticatedUser }> {
    const res = await apiClient.get(`/login?ticket=${encodeURIComponent(ticket)}&service=${encodeURIComponent(service)}`);
    if (res.data?.token) {
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
    }
    return res.data;
  },

  getStoredUser(): AuthenticatedUser | null {
    try {
      const raw = localStorage.getItem('user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  logout(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }
};
