import $ from 'jquery/slim';
import {
  DATA_KEY_CHANNEL_ITEM_CONTENTS_CONTAINER_CHANNEL_ID,
  DATA_KEY_CHANNEL_ITEM_CONTENTS_CONTAINER_CHANNEL_TYPE,
  DATA_KEY_CHANNEL_NAME,
  DATA_KEY_CHANNEL_PREFIX,
  DATA_KEY_RAW_CHANNEL_NAME,
  SELECTOR_CHANNEL_ITEM_CONTENTS_CONTAINER,
  SELECTOR_CHANNEL_ITEM_NAME_SELECTOR,
  SELECTOR_CHANNEL_LIST_ITEMS,
} from '../dom-constants';
import {
  type ChannelItemContext,
  ChannelItemContextGroupType,
  type ChannelItemType,
  type ChannelManipulator,
  type GroupedChannelItemContext,
} from './channel-manipulator';

export class DomChannelManipulator implements ChannelManipulator {
  public getChannelItemContexts(): ChannelItemContext[] {
    const $channelItems = $(SELECTOR_CHANNEL_LIST_ITEMS);

    return Array.from($channelItems).map((channelItemElement, index) =>
      this.readChannelItem(channelItemElement, index),
    );
  }

  /**
   * Read a sidebar item. `name` is always the channel name on Slack, even when an alias is displayed.
   */
  public readChannelItem(channelItemElement: Element, index = -1): ChannelItemContext {
    const $channelItem = $(channelItemElement);
    const $channelName = $channelItem.find(SELECTOR_CHANNEL_ITEM_NAME_SELECTOR);
    const $channelContentsContainer = $channelItem.find(SELECTOR_CHANNEL_ITEM_CONTENTS_CONTAINER);
    const dataChannelItemType = $channelContentsContainer.attr(DATA_KEY_CHANNEL_ITEM_CONTENTS_CONTAINER_CHANNEL_TYPE);
    const channelItemType = (dataChannelItemType ?? null) as ChannelItemType;
    const isAlreadyApplied = $channelName.find('span.scg').length > 0;
    let channelName: string;

    // Get ch name
    if (isAlreadyApplied && $channelName.data(DATA_KEY_RAW_CHANNEL_NAME)) {
      channelName = $channelName.data(DATA_KEY_RAW_CHANNEL_NAME);
    } else {
      channelName = $channelName.text().trim();
    }

    return {
      index,
      name: channelName,
      channelItemType,
      id: this.readChannelId($channelItem),
    };
  }

  public persistGroupedChannelItemContexts(channelItemContexts: GroupedChannelItemContext[]): void {
    const $channelItems = $(SELECTOR_CHANNEL_LIST_ITEMS);

    channelItemContexts.forEach((context, index) => {
      const $channelName = $channelItems.eq(index).find(SELECTOR_CHANNEL_ITEM_NAME_SELECTOR);
      $channelName.data(DATA_KEY_RAW_CHANNEL_NAME, context.rawName);
      $channelName.data(DATA_KEY_CHANNEL_NAME, context.name);
      $channelName.data(DATA_KEY_CHANNEL_PREFIX, context.prefix);
    });
  }

  public updateChannelItems(channelItemContexts: GroupedChannelItemContext[]): void {
    const $channelItems = $(SELECTOR_CHANNEL_LIST_ITEMS);

    // Use requestAnimationFrame to avoid blocking click events
    requestAnimationFrame(() => {
      $channelItems.each((index: number, channelItem: HTMLElement) => {
        const context = channelItemContexts[index];
        const $channelName = $(channelItem).find(SELECTOR_CHANNEL_ITEM_NAME_SELECTOR);
        const channelItemType = context.channelItemType;
        const prefix: string | null = context.prefix;
        const isParent = context.groupType === ChannelItemContextGroupType.Parent;
        const isLastChild = context.groupType === ChannelItemContextGroupType.LastChild;
        let separator = '';

        // Skip direct message
        if (channelItemType === 'im') {
          return;
        }

        // Skip blank item
        if ($channelName.length === 0) {
          return;
        }

        if (prefix === null || context.groupType === ChannelItemContextGroupType.Alone) {
          if (context.alias !== null) {
            this.applyAliasToChannelName($channelName, context.alias);
          } else if (prefix !== null || $channelName.find('span.scg').length > 0) {
            // Undo grouping or a removed alias. Items Slack rendered as is are left untouched.
            this.resetChannelName($channelName, context.rawName);
          }
          return;
        }

        let separatorPseudoClass: string;

        if (isParent) {
          separator = '┬';
          separatorPseudoClass = 'scg-ch-separator-pseudo-bottom';
        } else if (isLastChild) {
          separator = '└';
          separatorPseudoClass = 'scg-ch-separator-pseudo-top';
        } else {
          separator = '├';
          separatorPseudoClass = 'scg-ch-separator-pseudo-both';
        }

        this.applyGroupingToChannelName($channelName, context, separator, separatorPseudoClass, isParent);
      });
    });
  }

  private readChannelId($channelItem: JQuery<Element>): string | null {
    const selector = `[${DATA_KEY_CHANNEL_ITEM_CONTENTS_CONTAINER_CHANNEL_ID}]`;
    const $withId = $channelItem.is(selector) ? $channelItem : $channelItem.find(selector).first();
    return $withId.attr(DATA_KEY_CHANNEL_ITEM_CONTENTS_CONTAINER_CHANNEL_ID) || null;
  }

  private resetChannelName($channelName: JQuery<HTMLElement>, originalName: string): void {
    $channelName.removeClass('scg scg-ch-parent scg-ch-child').empty().text(originalName);
  }

  private applyAliasToChannelName($channelName: JQuery<HTMLElement>, alias: string): void {
    // Skip no changed
    const $current = $channelName.children('span.scg');
    if ($current.length === 1 && $current.hasClass('scg-ch-alias') && $current.text() === alias) {
      return;
    }

    $channelName
      .removeClass('scg scg-ch-parent scg-ch-child')
      .empty()
      .append($('<span>').addClass('scg scg-ch-alias').text(alias));
  }

  private applyGroupingToChannelName(
    $channelName: JQuery<HTMLElement>,
    context: GroupedChannelItemContext,
    separator: string,
    separatorPseudoClass: string,
    isParent: boolean,
  ): void {
    const prefixText = context.prefix ?? '';
    const nameText = context.name.replace(/(^.+?)[-_](.*)/, '$2');

    // Skip no changed
    if (
      separator === $channelName.find('.scg-ch-separator').text() &&
      prefixText === $channelName.find('.scg-ch-prefix').text() &&
      nameText === $channelName.find('.scg-ch-name').text()
    ) {
      return;
    }

    $channelName
      .removeClass('scg scg-ch-parent scg-ch-child')
      .addClass(isParent ? 'scg scg-ch-parent' : 'scg scg-ch-child')
      .empty()
      .append([
        $('<span>').addClass('scg scg-ch-prefix').text(prefixText),
        $('<span>').addClass(`scg scg-ch-separator ${separatorPseudoClass}`).text(separator),
        $('<span>').addClass('scg scg-ch-name').text(nameText),
      ]);
  }
}
