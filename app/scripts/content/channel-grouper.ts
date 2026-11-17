// modules
import 'requestidlecallback-polyfill';
import {
  type ChannelItemContext,
  ChannelItemContextGroupType,
  type ChannelManipulator,
  type GatheredChannelResolver,
  type GroupedChannelItemContext,
} from './channel-manipulators/channel-manipulator';
import { logger } from './logger';

// constants
const GROUPING_IDLE_CALLBACK_TIMEOUT = 3 * 1000;
const UPDATE_CHANNEL_LIST_MIN_INTERVAL = 200;
const REGEX_CHANNEL_MATCH = /(^.+?)[-_].*/;
const CHANNEL_NAME_ROOT = '-/';
// Prefix shown for the channels gathered at the end of a section
export const GATHERED_GROUP_PREFIX = '/';

type GatheredFields = Pick<GroupedChannelItemContext, 'rawName' | 'gathered'>;

/**
 * Channel Grouping Class
 */
export default class ChannelGrouper {
  private debounceEmitUpdateTimeoutId: number | null;
  private idleCallbackId: number | null;

  constructor(
    private readonly adapter: ChannelManipulator,
    private readonly isGathered: GatheredChannelResolver = () => false,
  ) {
    this.debounceEmitUpdateTimeoutId = null;
    this.idleCallbackId = null;
  }

  groupingOnIdleAndDebounce(): void {
    if (this.debounceEmitUpdateTimeoutId !== null) {
      window.clearTimeout(this.debounceEmitUpdateTimeoutId);
    }

    // Reduce infinity loop impact
    this.debounceEmitUpdateTimeoutId = window.setTimeout(() => {
      if (this.idleCallbackId !== null) {
        window.cancelIdleCallback(this.idleCallbackId);
      }

      this.idleCallbackId = window.requestIdleCallback(
        () => {
          this.grouping();
        },
        {
          timeout: GROUPING_IDLE_CALLBACK_TIMEOUT,
        },
      );
    }, UPDATE_CHANNEL_LIST_MIN_INTERVAL);
  }

  public grouping(): GroupedChannelItemContext[] | null {
    logger.labeledLog('Grouping all by prefix');

    const channelItemContexts = this.adapter.getChannelItemContexts();
    if (!channelItemContexts) {
      return null;
    }

    const groupedChannelItemContext = this.applyGroupingToContexts(this.gatherContexts(channelItemContexts));

    logger.labeledLog('Grouped channelItemContexts:', groupedChannelItemContext);

    this.adapter.persistGroupedChannelItemContexts(groupedChannelItemContext);

    this.adapter.updateChannelItems(groupedChannelItemContext);

    return groupedChannelItemContext;
  }

  /**
   * Move the picked channels to the end of their section and name them under GATHERED_GROUP_PREFIX.
   * A section is a run of consecutive channel items; headers and buttons (no channel type) split sections.
   * Other items keep Slack's order.
   */
  private gatherContexts(channelItemContexts: ChannelItemContext[]): (ChannelItemContext & GatheredFields)[] {
    const result: (ChannelItemContext & GatheredFields)[] = [];
    let staying: (ChannelItemContext & GatheredFields)[] = [];
    let gathered: (ChannelItemContext & GatheredFields)[] = [];

    const flushSection = () => {
      result.push(...staying, ...gathered);
      staying = [];
      gathered = [];
    };

    for (const context of channelItemContexts) {
      if (context.channelItemType === null) {
        flushSection();
        result.push({ ...context, rawName: context.name, gathered: false });
        continue;
      }

      const isDirectMessage = context.channelItemType === 'im' || context.channelItemType === 'mpim';
      if (!isDirectMessage && context.name !== '' && this.isGathered(context)) {
        gathered.push({
          ...context,
          name: `${GATHERED_GROUP_PREFIX}-${context.name}`,
          rawName: context.name,
          gathered: true,
        });
      } else {
        staying.push({ ...context, rawName: context.name, gathered: false });
      }
    }
    flushSection();

    return result;
  }

  private applyGroupingToContexts(
    channelItemContexts: (ChannelItemContext & GatheredFields)[],
  ): GroupedChannelItemContext[] {
    const prefixeMap = new Map<number, string | null>();

    // Process for root
    // If next channel name is same as prefix, rename it like 'prefix-/'
    channelItemContexts.forEach((context, index) => {
      const nextName = channelItemContexts[index + 1]?.name ?? null;
      if (nextName === null) {
        return;
      }

      const nextPrefix = nextName.match(REGEX_CHANNEL_MATCH)?.[1] ?? null;
      const isRoot = nextPrefix === context.name;

      if (isRoot) {
        context.name = `${context.name}${CHANNEL_NAME_ROOT}`;
      }
    });

    // Get prefix map (keyed by display position)
    channelItemContexts.forEach((context, position) => {
      const prefix = context.name.match(REGEX_CHANNEL_MATCH)?.[1] ?? null;
      prefixeMap.set(position, prefix);
    });

    // Grouping
    return channelItemContexts.map((context, index): GroupedChannelItemContext => {
      const currentPrefix = prefixeMap.get(index) ?? null;
      const prevPrefix = prefixeMap.get(index - 1) ?? null;
      const nextPrefix = prefixeMap.get(index + 1) ?? null;

      let groupType: ChannelItemContextGroupType | null = null;

      // If channelItemType is 'im' or 'mpim', skip grouping
      if (context.channelItemType === 'im' || context.channelItemType === 'mpim') {
        return {
          ...context,
          prefix: null,
          groupType: ChannelItemContextGroupType.Alone,
        };
      }

      if (currentPrefix === null || (currentPrefix !== prevPrefix && currentPrefix !== nextPrefix)) {
        groupType = ChannelItemContextGroupType.Alone;
      } else {
        if (prevPrefix !== currentPrefix && nextPrefix === currentPrefix) {
          groupType = ChannelItemContextGroupType.Parent;
        } else {
          if (nextPrefix !== currentPrefix) {
            groupType = ChannelItemContextGroupType.LastChild;
          } else {
            groupType = ChannelItemContextGroupType.Child;
          }
        }
      }

      return {
        ...context,
        prefix: currentPrefix,
        groupType,
      };
    });
  }
}
