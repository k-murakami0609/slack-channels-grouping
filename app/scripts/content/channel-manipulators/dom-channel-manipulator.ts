import $ from 'jquery/slim';
import {
  CLASS_CHANNEL_ITEM_MUTED,
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

const DATA_KEY_SLACK_Y = 'data-scg-slack-y';
const DATA_KEY_MOVED_Y = 'data-scg-moved-y';

const readTranslateY = (element: HTMLElement): number | null => {
  const match = element.style.transform.match(/translateY\((-?[\d.]+)px\)/);
  return match ? Number(match[1]) : null;
};

export class DomChannelManipulator implements ChannelManipulator {
  public getChannelItemContexts(): ChannelItemContext[] {
    const $channelItems = $(SELECTOR_CHANNEL_LIST_ITEMS);

    return Array.from($channelItems).map((channelItemElement, index) =>
      this.readChannelItem(channelItemElement, index),
    );
  }

  /**
   * Read a sidebar item. `name` is always the channel name on Slack, even while the extension changes the label.
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
      muted: $channelContentsContainer.hasClass(CLASS_CHANNEL_ITEM_MUTED),
    };
  }

  public persistGroupedChannelItemContexts(channelItemContexts: GroupedChannelItemContext[]): void {
    const $channelItems = $(SELECTOR_CHANNEL_LIST_ITEMS);

    channelItemContexts.forEach((context) => {
      const $channelName = $channelItems.eq(context.index).find(SELECTOR_CHANNEL_ITEM_NAME_SELECTOR);
      $channelName.data(DATA_KEY_RAW_CHANNEL_NAME, context.rawName);
      $channelName.data(DATA_KEY_CHANNEL_NAME, context.name);
      $channelName.data(DATA_KEY_CHANNEL_PREFIX, context.prefix);
    });
  }

  public updateChannelItems(channelItemContexts: GroupedChannelItemContext[]): void {
    const $channelItems = $(SELECTOR_CHANNEL_LIST_ITEMS);

    // Use requestAnimationFrame to avoid blocking click events
    requestAnimationFrame(() => {
      this.moveChannelItems($channelItems.toArray(), channelItemContexts);

      channelItemContexts.forEach((context) => {
        const channelItem = $channelItems.get(context.index);
        if (channelItem === undefined) {
          return;
        }
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
          if (prefix !== null || $channelName.find('span.scg').length > 0) {
            // Undo grouping. Items Slack rendered as is are left untouched.
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

  /**
   * Slack places each item with `transform: translateY(...)`. Give the item shown at position N
   * the Y that Slack gave to the N-th item, so gathered channels appear at the end of their section.
   */
  private moveChannelItems(channelItems: HTMLElement[], channelItemContexts: GroupedChannelItemContext[]): void {
    const slackYs = channelItems.map((channelItem) => this.readSlackY(channelItem));

    channelItemContexts.forEach((context, position) => {
      const channelItem = channelItems[context.index];
      const slackY = slackYs[context.index];
      const targetY = slackYs[position];
      if (channelItem === undefined || slackY === null || targetY === null || targetY === undefined) {
        return;
      }

      if (targetY === slackY) {
        // Put back to Slack's position if it was moved before
        if (channelItem.hasAttribute(DATA_KEY_MOVED_Y)) {
          channelItem.style.transform = `translateY(${slackY}px)`;
          channelItem.removeAttribute(DATA_KEY_MOVED_Y);
          channelItem.removeAttribute(DATA_KEY_SLACK_Y);
        }
        return;
      }

      if (readTranslateY(channelItem) !== targetY) {
        channelItem.style.transform = `translateY(${targetY}px)`;
      }
      channelItem.setAttribute(DATA_KEY_SLACK_Y, String(slackY));
      channelItem.setAttribute(DATA_KEY_MOVED_Y, String(targetY));
    });
  }

  /**
   * Y that Slack set. If the extension moved the item and Slack has not re-rendered it since,
   * the current Y is ours, so return the remembered one.
   */
  private readSlackY(channelItem: HTMLElement): number | null {
    const currentY = readTranslateY(channelItem);
    const movedY = channelItem.getAttribute(DATA_KEY_MOVED_Y);
    const slackY = channelItem.getAttribute(DATA_KEY_SLACK_Y);

    if (currentY !== null && movedY !== null && slackY !== null && currentY === Number(movedY)) {
      return Number(slackY);
    }
    return currentY;
  }

  private readChannelId($channelItem: JQuery<Element>): string | null {
    const selector = `[${DATA_KEY_CHANNEL_ITEM_CONTENTS_CONTAINER_CHANNEL_ID}]`;
    const $withId = $channelItem.is(selector) ? $channelItem : $channelItem.find(selector).first();
    return $withId.attr(DATA_KEY_CHANNEL_ITEM_CONTENTS_CONTAINER_CHANNEL_ID) || null;
  }

  private resetChannelName($channelName: JQuery<HTMLElement>, originalName: string): void {
    $channelName.removeClass('scg scg-ch-parent scg-ch-child').empty().text(originalName);
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
