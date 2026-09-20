import { Resource } from 'idea-toolbox';

export class Configurations extends Resource {
  static PK = '1';
  PK = Configurations.PK;

  administratorsIds: string[];
  appTitle: string;
  supportEmail: string;

  constructor(data?: any) {
    super();
    if (data) {
      this.load(data);
    }
  }

  load(x: any): void {
    super.load(x);
    this.administratorsIds = this.cleanArray(x.administratorsIds, String).map(id => id.toLowerCase());
    this.appTitle = this.clean(x.appTitle, String, 'ESN Poland Finances');
    this.supportEmail = this.clean(x.supportEmail, String, 'finances@esn.pl');
  }

  safeLoad(newData: any, safeData: any): void {
    super.safeLoad(newData, safeData);
    this.PK = Configurations.PK;
  }

  validate(): string[] {
    const errors = super.validate();
    if (this.iE(this.administratorsIds)) errors.push('administratorsIds');
    return errors;
  }
}
