import { EventEmitter } from 'eventemitter3';
import { logger } from './logger';

export type ChannelAliases = Record<string, string>;

export const STORAGE_KEY_CHANNEL_ALIASES = 'channelAliases';

/**
 * Key for an alias. The channel ID is preferred because it survives channel renames;
 * the raw channel name is used only when the ID can not be read from the DOM.
 */
export const channelAliasKey = (id: string | null | undefined, rawName: string): string =>
  id ? id : `name:${rawName}`;

/**
 * Trimmed alias, or null when the input means "remove the alias".
 */
export const normalizeAlias = (input: string): string | null => {
  const trimmed = input.trim();
  return trimmed === '' ? null : trimmed;
};

const sanitizeAliases = (value: unknown): ChannelAliases => {
  if (typeof value !== 'object' || value === null) {
    return {};
  }

  const aliases: ChannelAliases = {};
  for (const [key, alias] of Object.entries(value)) {
    if (typeof alias === 'string' && alias !== '') {
      aliases[key] = alias;
    }
  }
  return aliases;
};

/**
 * Personal channel aliases kept in chrome.storage.local.
 * Nothing is sent to Slack, so aliases are visible only in this browser.
 */
export class ChannelAliasStore extends EventEmitter<'change'> {
  private aliases: ChannelAliases = {};

  constructor(private readonly storage: chrome.storage.StorageArea = chrome.storage.local) {
    super();
  }

  async load(): Promise<void> {
    this.aliases = await this.readFromStorage();
  }

  /**
   * Follow changes made in this tab and in other tabs.
   */
  watch(): void {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !(STORAGE_KEY_CHANNEL_ALIASES in changes)) {
        return;
      }

      logger.labeledLog('Channel aliases changed');
      this.aliases = sanitizeAliases(changes[STORAGE_KEY_CHANNEL_ALIASES].newValue);
      this.emit('change');
    });
  }

  get(key: string): string | null {
    return this.aliases[key] ?? null;
  }

  /**
   * Set the alias, or remove it when alias is null.
   */
  async set(key: string, alias: string | null): Promise<void> {
    // Re-read so that an alias saved from another tab is not overwritten
    const { [key]: _removed, ...others } = await this.readFromStorage();
    const next: ChannelAliases = alias === null ? others : { ...others, [key]: alias };

    this.aliases = next;
    await this.storage.set({ [STORAGE_KEY_CHANNEL_ALIASES]: next });
  }

  private async readFromStorage(): Promise<ChannelAliases> {
    const result = await this.storage.get(STORAGE_KEY_CHANNEL_ALIASES);
    return sanitizeAliases(result[STORAGE_KEY_CHANNEL_ALIASES]);
  }
}
