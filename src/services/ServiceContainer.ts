export class ServiceContainer {
  private services = new Map<string, unknown>();
  private serviceFactories = new Map<string, () => unknown>();

  hasService(serviceKey: string): boolean {
    return this.serviceFactories.has(serviceKey);
  }

  register<T>(serviceKey: string, serviceFactory: () => T, allowOverride: boolean = false): void {
    if (this.hasService(serviceKey) && !allowOverride) {
      throw new Error(`Service ${serviceKey} is already registered. Use allowOverride=true to replace.`);
    }

    if (allowOverride && this.services.has(serviceKey)) {
      this.services.delete(serviceKey);
    }

    this.serviceFactories.set(serviceKey, serviceFactory);
  }

  safeRegister<T>(serviceKey: string, serviceFactory: () => T): void {
    this.register(serviceKey, serviceFactory, true);
  }

  get<T>(serviceKey: string): T {
    if (!this.services.has(serviceKey)) {
      const factory = this.serviceFactories.get(serviceKey);
      if (!factory) {
        throw new Error(`Service ${serviceKey} not registered. Available services: ${Array.from(this.serviceFactories.keys()).join(', ')}`);
      }
      this.services.set(serviceKey, factory());
    }
    return this.services.get(serviceKey) as T;
  }

  unregister(serviceKey: string): boolean {
    const hadFactory = this.serviceFactories.delete(serviceKey);
    const hadInstance = this.services.delete(serviceKey);
    return hadFactory || hadInstance;
  }

  clear(): void {
    this.services.clear();
  }

  reset(): void {
    this.services.clear();
    this.serviceFactories.clear();
  }

  size(): number {
    return this.serviceFactories.size;
  }

  getRegisteredServices(): string[] {
    return Array.from(this.serviceFactories.keys());
  }
}
