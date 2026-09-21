import { Injectable } from '@angular/core';
import { IDEAApiService } from '@idea-ionic/common';
import { Configurations } from '@models/configurations.model';

@Injectable({ providedIn: 'root' })
export class ConfigurationsService {
  constructor(private api: IDEAApiService) {}

  /**
   * Load the platform configurations from the backend.
   */
  async get(): Promise<Configurations> {
    return new Configurations(await this.api.getResource('configurations'));
  }

  /**
   * Update the platform configurations.
   */
  async update(configurations: Configurations): Promise<Configurations> {
    return new Configurations(
      await this.api.putResource('configurations', { body: configurations })
    );
  }
}
