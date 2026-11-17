export enum ChannelItemContextGroupType {
  Parent = 'parent',
  Child = 'child',
  LastChild = 'lastChild',
  Alone = 'alone',
}

export type ChannelItemType = 'channel' | 'private' | 'im' | 'mpim';

export interface ChannelItemContext {
  index: number;
  name: string;
  channelItemType: ChannelItemType | null;
  // Slack channel ID (e.g. C0123456789). null when it can not be read from the DOM.
  id?: string | null;
}

/**
 * Grouped item. Items are ordered by display position; `index` still points to the DOM item.
 */
export interface GroupedChannelItemContext extends ChannelItemContext {
  // Channel name on Slack. `name` is the name used for grouping.
  rawName: string;
  // Picked by the user to be gathered at the end of its section.
  gathered: boolean;
  prefix: string | null;
  groupType: ChannelItemContextGroupType;
}

export type GatheredChannelResolver = (context: ChannelItemContext) => boolean;

export interface ChannelManipulator {
  getChannelItemContexts(): ChannelItemContext[];
  persistGroupedChannelItemContexts(channelItemContexts: GroupedChannelItemContext[]): void;
  updateChannelItems(channelItemContexts: GroupedChannelItemContext[]): void;
}
