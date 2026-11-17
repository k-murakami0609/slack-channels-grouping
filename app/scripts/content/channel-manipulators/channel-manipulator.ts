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

export interface GroupedChannelItemContext extends ChannelItemContext {
  // Channel name on Slack. `name` is the name used for grouping (alias if set).
  rawName: string;
  // Personal alias of the channel, or null.
  alias: string | null;
  prefix: string | null;
  groupType: ChannelItemContextGroupType;
}

export type ChannelAliasResolver = (context: ChannelItemContext) => string | null;

export interface ChannelManipulator {
  getChannelItemContexts(): ChannelItemContext[];
  persistGroupedChannelItemContexts(channelItemContexts: GroupedChannelItemContext[]): void;
  updateChannelItems(channelItemContexts: GroupedChannelItemContext[]): void;
}
