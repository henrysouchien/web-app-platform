export class UpgradeRequiredError extends Error {
  readonly tierRequired: string;
  readonly tierCurrent: string;
  readonly status = 403;

  constructor(tierRequired: string, tierCurrent: string, message?: string) {
    super(message ?? `This feature requires a ${tierRequired} subscription.`);
    this.name = 'UpgradeRequiredError';
    this.tierRequired = tierRequired;
    this.tierCurrent = tierCurrent;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
