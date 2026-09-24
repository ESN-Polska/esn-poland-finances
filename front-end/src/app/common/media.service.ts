import { Injectable } from '@angular/core';
import { IDEAApiService } from '@idea-ionic/common';

@Injectable({ providedIn: 'root' })
export class MediaService {
  constructor(private api: IDEAApiService) {}

  /**
   * Upload a new image file and get its URI identifier.
   */
  async uploadImage(file: File): Promise<string> {
    const { url, id } = await this.api.postResource('media');
    await fetch(url, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type }
    });
    // Brief pause to allow S3 object visibility
    await new Promise(resolve => setTimeout(resolve, 1500));
    return id;
  }

  /**
   * Upload a new document file and get its public CDN URL.
   */
  async uploadDocument(file: File): Promise<{ id: string; url: string; s3Key: string }> {
    const extension = file.name.split('.').pop()?.toLowerCase() || 'pdf';
    const res = await this.api.postResource('media', {
      body: { type: 'document', extension, filename: file.name }
    });
    const putRes = await fetch(res.url, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' }
    });
    if (!putRes.ok) {
      throw new Error(`Upload to storage failed (${putRes.status} ${putRes.statusText})`);
    }
    // Brief pause to allow S3 object visibility
    await new Promise(resolve => setTimeout(resolve, 1500));
    return { id: res.id, url: res.cdnUrl || res.url, s3Key: res.key };
  }
}
