import { setupChannelAliasEditor } from './content/channel-alias-editor';
import { ChannelAliasStore, channelAliasKey } from './content/channel-alias-store';
import ChannelGrouper from './content/channel-grouper';
import { DomChannelManipulator } from './content/channel-manipulators/dom-channel-manipulator';
import ChannelObserver from './content/channel-observer';
import * as domConstants from './content/dom-constants';
import { logger } from './content/logger';
import { isAlreadyRunningExtension } from './content/utils/extension-running-checker';
import { waitElementRender } from './content/utils/wait-element-render';

const RUNNING_CHECK_IDENTIFIER = 'slack-channels-grouping';
const WAIT_RENDER_CHANNEL_LIST_TIMEOUT = 1000 * 60;
const WAIT_RENDER_CHANNEL_LIST_INTERVAL = 200;

((): void => {
  waitElementRender(
    domConstants.SELECTOR_CHANNEL_LIST_ITEMS,
    WAIT_RENDER_CHANNEL_LIST_INTERVAL,
    WAIT_RENDER_CHANNEL_LIST_TIMEOUT,
  )
    .then(async () => {
      // Check already running extension
      if (isAlreadyRunningExtension(RUNNING_CHECK_IDENTIFIER)) {
        logger.labeledLog('Extension is already running. Skip apply.');
        return;
      }

      logger.labeledLog('Rendered channel list item.');

      const channelObserver = new ChannelObserver();
      const domChannnelManipulator = new DomChannelManipulator();
      const channelAliasStore = new ChannelAliasStore();
      const channelGrouper = new ChannelGrouper(domChannnelManipulator, (context) =>
        channelAliasStore.get(channelAliasKey(context.id, context.name)),
      );

      // Load personal channel aliases. Grouping still works without them.
      try {
        await channelAliasStore.load();
        channelAliasStore.watch();
        channelAliasStore.on('change', () => {
          channelGrouper.groupingOnIdleAndDebounce();
        });
        setupChannelAliasEditor(channelAliasStore, domChannnelManipulator);
      } catch (error) {
        console.warn(
          'Slack Channels Grouping: channel aliases are unavailable. Reload this page to enable them.',
          error,
        );
      }

      // Grouping
      channelGrouper.groupingOnIdleAndDebounce();

      // Grouping on update
      channelObserver.on('update', () => {
        channelGrouper.groupingOnIdleAndDebounce();
      });

      channelObserver.startObserve();
    })
    .catch(() => {
      logger.labeledLog('Fail to wait channel list item.');
      // Do nothing
    });
})();
