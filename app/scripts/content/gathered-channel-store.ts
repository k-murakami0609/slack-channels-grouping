import { EventEmitter } from 'eventemitter3';
import { logger } from './logger';

export const STORAGE_KEY_GATHERED_CHANNELS = 'gatheredChannels';

/**
 * Key of a channel. The channel ID is preferred because it survives channel renames;
 * the channel name is used only when the ID can not be read from the DOM.
 */
export const channelKey = (id: string | null | undefined, name: string): string => (id ? id : `name:${name}`);

const sanitizeKeys = (value: unknown): Set<string> => {
  if (!Array.isArray(value)) {
    return new Set();
  }
  return new Set(value.filter((key): key is string => typeof key === 'string' && key !== ''));
};

/**
 * Channels the user picked to gather at the end of their sidebar section.
 * Kept in chrome.storage.local, so nothing changes on Slack or for other members.
 */
export class GatheredChannelStore extends EventEmitter<'change'> {
  private keys = new Set<string>();

  constructor(private readonly storage: chrome.storage.StorageArea = chrome.storage.local) {
    super();
  }

  async load(): Promise<void> {
    this.keys = await this.readFromStorage();
  }

  /**
   * Follow changes made in this tab and in other tabs.
   */
  watch(): void {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !(STORAGE_KEY_GATHERED_CHANNELS in changes)) {
        return;
      }

      logger.labeledLog('Gathered channels changed');
      this.keys = sanitizeKeys(changes[STORAGE_KEY_GATHERED_CHANNELS].newValue);
      this.emit('change');
    });
  }

  has(key: string): boolean {
    return this.keys.has(key);
  }

  /**
   * Add the channel, or remove it when it is already gathered.
   */
  async toggle(key: string): Promise<void> {
    // Re-read so that a change saved from another tab is not overwritten
    const next = await this.readFromStorage();
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }

    this.keys = next;
    await this.storage.set({ [STORAGE_KEY_GATHERED_CHANNELS]: [...next] });
  }

  private async readFromStorage(): Promise<Set<string>> {
    const result = await this.storage.get(STORAGE_KEY_GATHERED_CHANNELS);
    return sanitizeKeys(result[STORAGE_KEY_GATHERED_CHANNELS]);
  }
}
