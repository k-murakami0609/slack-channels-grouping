import { type ChannelAliasStore, channelAliasKey, normalizeAlias } from './channel-alias-store';
import type { DomChannelManipulator } from './channel-manipulators/dom-channel-manipulator';
import { SELECTOR_CHANNEL_LIST_ITEMS } from './dom-constants';

const promptMessage = (rawName: string): string => {
  try {
    const message = chrome.i18n.getMessage('aliasPrompt', [rawName]);
    if (message) {
      return message;
    }
  } catch {
    // Extension context may be invalidated after the extension is reloaded
  }
  return `Alias for #${rawName} (leave empty to remove)`;
};

/**
 * Alt (Option) + click on a sidebar channel to set, change or remove its alias.
 */
export const setupChannelAliasEditor = (store: ChannelAliasStore, manipulator: DomChannelManipulator): void => {
  window.addEventListener(
    'click',
    (event) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const channelItem = target.closest(SELECTOR_CHANNEL_LIST_ITEMS);
      if (channelItem === null) {
        return;
      }

      const context = manipulator.readChannelItem(channelItem);
      if (context.name === '' || context.channelItemType === 'im' || context.channelItemType === 'mpim') {
        return;
      }

      // Keep Slack from handling this click (e.g. opening the channel)
      event.preventDefault();
      event.stopImmediatePropagation();

      const key = channelAliasKey(context.id, context.name);
      const input = window.prompt(promptMessage(context.name), store.get(key) ?? '');
      if (input === null) {
        return;
      }

      store.set(key, normalizeAlias(input)).catch((error) => {
        console.warn('Slack Channels Grouping: failed to save channel alias:', error);
        window.alert('Slack Channels Grouping: failed to save the alias. Please reload this page and try again.');
      });
    },
    true,
  );
};
