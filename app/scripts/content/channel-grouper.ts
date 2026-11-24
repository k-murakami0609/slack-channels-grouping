// modules
import 'requestidlecallback-polyfill';
import {
  type ChannelItemContext,
  ChannelItemContextGroupType,
  type ChannelManipulator,
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
    // Gather lone channels (no other channel shares their prefix) at the end of their section
    private readonly options: { gatherLoneChannels: boolean } = { gatherLoneChannels: true },
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

    const loneIndexes = this.options.gatherLoneChannels
      ? this.findLoneChannelIndexes(channelItemContexts)
      : new Set<number>();
    const groupedChannelItemContext = this.applyGroupingToContexts(
      this.gatherContexts(channelItemContexts, (context) => loneIndexes.has(context.index)),
    );

    logger.labeledLog('Grouped channelItemContexts:', groupedChannelItemContext);

    this.adapter.persistGroupedChannelItemContexts(groupedChannelItemContext);

    this.adapter.updateChannelItems(groupedChannelItemContext);

    return groupedChannelItemContext;
  }

  /**
   * Channels that do not belong to any prefix group (no neighbor shares their prefix).
   * Direct messages, muted channels and blank items are left out.
   */
  private findLoneChannelIndexes(channelItemContexts: ChannelItemContext[]): Set<number> {
    const grouped = this.applyGroupingToContexts(
      channelItemContexts.map((context) => ({ ...context, rawName: context.name, gathered: false })),
    );

    return new Set(
      grouped
        .filter(
          (context) =>
            context.groupType === ChannelItemContextGroupType.Alone &&
            (context.channelItemType === 'channel' || context.channelItemType === 'private') &&
            context.rawName !== '' &&
            !context.muted,
        )
        .map((context) => context.index),
    );
  }

  /**
   * Move the lone channels to the end of their section (above the muted channels Slack puts last)
   * and name them under GATHERED_GROUP_PREFIX.
   * A section is a run of consecutive channel items; headers and buttons (no channel type) split sections.
   * A section with fewer than two lone channels is left as is. Other items keep Slack's order.
   */
  private gatherContexts(
    channelItemContexts: ChannelItemContext[],
    shouldGather: (context: ChannelItemContext) => boolean,
  ): (ChannelItemContext & GatheredFields)[] {
    const result: (ChannelItemContext & GatheredFields)[] = [];
    let section: ChannelItemContext[] = [];

    const asIs = (context: ChannelItemContext): ChannelItemContext & GatheredFields => ({
      ...context,
      rawName: context.name,
      gathered: false,
    });

    const flushSection = () => {
      const gathered = section.filter(shouldGather);
      if (gathered.length < 2) {
        result.push(...section.map(asIs));
        section = [];
        return;
      }

      const staying = section.filter((context) => !shouldGather(context));
      let mutedTailStart = staying.length;
      while (mutedTailStart > 0 && staying[mutedTailStart - 1].muted) {
        mutedTailStart--;
      }
      result.push(
        ...staying.slice(0, mutedTailStart).map(asIs),
        ...gathered.map((context) => ({
          ...context,
          name: `${GATHERED_GROUP_PREFIX}-${context.name}`,
          rawName: context.name,
          gathered: true,
        })),
        ...staying.slice(mutedTailStart).map(asIs),
      );
      section = [];
    };

    for (const context of channelItemContexts) {
      if (context.channelItemType === null) {
        flushSection();
        result.push(asIs(context));
        continue;
      }
      section.push(context);
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
