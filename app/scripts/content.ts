import ChannelGrouper from './content/channel-grouper';
import { DomChannelManipulator } from './content/channel-manipulators/dom-channel-manipulator';
import ChannelObserver from './content/channel-observer';
import * as domConstants from './content/dom-constants';
import { setupGatheredChannelEditor } from './content/gathered-channel-editor';
import { GatheredChannelStore, channelKey } from './content/gathered-channel-store';
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
      const gatheredChannelStore = new GatheredChannelStore();
      const channelGrouper = new ChannelGrouper(domChannnelManipulator, (context) =>
        gatheredChannelStore.has(channelKey(context.id, context.name)),
      );

      // Load the channels picked to be gathered. Grouping still works without them.
      try {
        await gatheredChannelStore.load();
        gatheredChannelStore.watch();
        gatheredChannelStore.on('change', () => {
          channelGrouper.groupingOnIdleAndDebounce();
        });
        setupGatheredChannelEditor(gatheredChannelStore, domChannnelManipulator);
      } catch (error) {
        console.warn(
          'Slack Channels Grouping: gathered channels are unavailable. Reload this page to enable them.',
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
