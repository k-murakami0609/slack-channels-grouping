import type { DomChannelManipulator } from './channel-manipulators/dom-channel-manipulator';
import { SELECTOR_CHANNEL_LIST_ITEMS } from './dom-constants';
import { type GatheredChannelStore, channelKey } from './gathered-channel-store';

/**
 * Alt (Option) + click on a sidebar channel to gather it at the end of its section, or to put it back.
 */
export const setupGatheredChannelEditor = (store: GatheredChannelStore, manipulator: DomChannelManipulator): void => {
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

      store.toggle(channelKey(context.id, context.name)).catch((error) => {
        console.warn('Slack Channels Grouping: failed to save the gathered channel:', error);
        window.alert('Slack Channels Grouping: failed to save. Please reload this page and try again.');
      });
    },
    true,
  );
};
