const BROADCAST_CHANNEL_NAME = 'risk-app';

export class LogoutBroadcaster {
  private channel: BroadcastChannel | null = null;

  constructor() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    }
  }

  broadcastLogout(): void {
    if (this.channel) {
      this.channel.postMessage({ type: 'logout', timestamp: Date.now() });
    }
  }

  onLogoutBroadcast(callback: () => void): () => void {
    if (!this.channel) {
      return () => {};
    }

    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'logout') {
        callback();
      }
    };

    this.channel.addEventListener('message', handler);

    return () => {
      if (this.channel) {
        this.channel.removeEventListener('message', handler);
      }
    };
  }

  cleanup(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }
}

export const logoutBroadcaster = new LogoutBroadcaster();

export const broadcastLogout = (): void => logoutBroadcaster.broadcastLogout();
