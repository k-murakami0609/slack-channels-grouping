import { describe, expect, it } from 'vitest';
import ChannelGrouper from '../app/scripts/content/channel-grouper';
import {
  type ChannelItemContext,
  ChannelItemContextGroupType,
  type ChannelManipulator,
} from '../app/scripts/content/channel-manipulators/channel-manipulator';
import { DomChannelManipulator } from '../app/scripts/content/channel-manipulators/dom-channel-manipulator';

class MockChannelManipulator implements ChannelManipulator {
  constructor(private readonly channels: ChannelItemContext[]) {}

  getChannelItemContexts(): ChannelItemContext[] {
    return this.channels;
  }

  persistGroupedChannelItemContexts(): void {}

  updateChannelItems(): void {}
}

const group = (channels: ChannelItemContext[]) =>
  new ChannelGrouper(new MockChannelManipulator(channels)).grouping() ?? [];

const channel = (index: number, name: string, extra: Partial<ChannelItemContext> = {}): ChannelItemContext => ({
  index,
  id: `C${index}`,
  name,
  channelItemType: 'channel',
  ...extra,
});

describe('ChannelGrouper with lone channels', () => {
  it('gathers channels without a prefix group at the end of the section under "/"', () => {
    const result = group([
      channel(0, 'alert_kintai'),
      channel(1, 'app_request'),
      channel(2, 'ask-develop'),
      channel(3, 'ask-hr'),
      channel(4, 'bank_pl', { channelItemType: 'private' }),
      channel(5, 'general'),
    ]);

    expect(result.map(({ index, rawName, prefix, groupType }) => ({ index, rawName, prefix, groupType }))).toEqual([
      { index: 2, rawName: 'ask-develop', prefix: 'ask', groupType: ChannelItemContextGroupType.Parent },
      { index: 3, rawName: 'ask-hr', prefix: 'ask', groupType: ChannelItemContextGroupType.LastChild },
      { index: 0, rawName: 'alert_kintai', prefix: '/', groupType: ChannelItemContextGroupType.Parent },
      { index: 1, rawName: 'app_request', prefix: '/', groupType: ChannelItemContextGroupType.Child },
      { index: 4, rawName: 'bank_pl', prefix: '/', groupType: ChannelItemContextGroupType.Child },
      { index: 5, rawName: 'general', prefix: '/', groupType: ChannelItemContextGroupType.LastChild },
    ]);
  });

  it('keeps a root channel such as "develop" in its group', () => {
    const result = group([
      channel(0, 'develop'),
      channel(1, 'develop-kintai'),
      channel(2, 'fyi'),
      channel(3, 'general'),
    ]);

    expect(result.map(({ index, gathered }) => ({ index, gathered }))).toEqual([
      { index: 0, gathered: false },
      { index: 1, gathered: false },
      { index: 2, gathered: true },
      { index: 3, gathered: true },
    ]);
  });

  it('gathers inside each section', () => {
    const result = group([
      { index: 0, name: 'Section A', channelItemType: null },
      channel(1, 'a-1'),
      channel(2, 'b'),
      channel(3, 'c'),
      channel(4, 'd'),
      { index: 5, name: 'Section B', channelItemType: null },
      channel(6, 'x'),
      channel(7, 'y'),
    ]);

    expect(result.map(({ index }) => index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(result.filter((context) => context.gathered).map(({ rawName }) => rawName)).toEqual([
      'a-1',
      'b',
      'c',
      'd',
      'x',
      'y',
    ]);
  });

  it('leaves a section with only one lone channel as is', () => {
    const result = group([channel(0, 'alone'), channel(1, 'g-1'), channel(2, 'g-2')]);

    expect(result.map(({ index, gathered }) => ({ index, gathered }))).toEqual([
      { index: 0, gathered: false },
      { index: 1, gathered: false },
      { index: 2, gathered: false },
    ]);
  });

  it('does not gather direct messages', () => {
    const result = group([
      { index: 0, id: 'D1', name: 'someone', channelItemType: 'im' },
      { index: 1, id: 'D2', name: 'other', channelItemType: 'im' },
      { index: 2, id: 'D3', name: 'group', channelItemType: 'mpim' },
    ]);

    expect(result.map(({ index, gathered }) => ({ index, gathered }))).toEqual([
      { index: 0, gathered: false },
      { index: 1, gathered: false },
      { index: 2, gathered: false },
    ]);
  });
});

describe('lone channels with muted channels', () => {
  it('puts the gathered channels above the muted channels at the end of the section and leaves muted ones', () => {
    const result = group([
      channel(0, 'alert_kintai'),
      channel(1, 'muted-a', { muted: true }),
      channel(2, 'general'),
      channel(3, 'old-a', { muted: true }),
      channel(4, 'zzz', { muted: true }),
      { index: 5, name: 'Direct messages', channelItemType: null },
    ]);

    // Muted channels are not gathered and stay below the gathered ones
    expect(result.map(({ index }) => index)).toEqual([0, 2, 1, 3, 4, 5]);
    expect(result.filter((context) => context.gathered).map(({ rawName }) => rawName)).toEqual([
      'alert_kintai',
      'general',
    ]);
  });

  it('reads the muted state from the sidebar', () => {
    document.body.innerHTML = `
      <div class="p-channel_sidebar__static_list">
        <div role="treeitem">
          <div class="p-channel_sidebar__channel p-channel_sidebar__channel--muted" data-qa-channel-sidebar-channel-type="channel" data-qa-channel-sidebar-channel-id="C1">
            <span class="p-channel_sidebar__name">muted</span>
          </div>
        </div>
        <div role="treeitem">
          <div class="p-channel_sidebar__channel" data-qa-channel-sidebar-channel-type="channel" data-qa-channel-sidebar-channel-id="C2">
            <span class="p-channel_sidebar__name">normal</span>
          </div>
        </div>
      </div>`;

    expect(new DomChannelManipulator().getChannelItemContexts().map(({ name, muted }) => ({ name, muted }))).toEqual([
      { name: 'muted', muted: true },
      { name: 'normal', muted: false },
    ]);
  });
});

describe('DomChannelManipulator with lone channels', () => {
  // Mimics Slack's sidebar: every item is positioned with translateY
  const renderSidebar = (items: ({ id: string; name: string } | { heading: string })[]) => {
    document.body.innerHTML = `
      <div class="p-channel_sidebar__static_list">
        <div class="c-virtual_list__scroll_container">
          ${items
            .map((item, position) => {
              const style = `top: 0px; transform: translateY(${position * 28}px); height: 28px;`;
              if ('heading' in item) {
                return `<div role="treeitem" style="${style}"><span>${item.heading}</span></div>`;
              }
              return `
                <div role="treeitem" style="${style}">
                  <div class="p-channel_sidebar__channel" data-qa-channel-sidebar-channel-type="channel" data-qa-channel-sidebar-channel-id="${item.id}">
                    <span class="p-channel_sidebar__name">${item.name}</span>
                  </div>
                </div>`;
            })
            .join('')}
        </div>
      </div>`;
  };

  // Labels sorted by displayed Y
  const displayedLabels = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[role=treeitem]'))
      .map((item) => ({
        y: Number(item.style.transform.match(/translateY\((-?[\d.]+)px\)/)?.[1]),
        label: item.querySelector('.p-channel_sidebar__name')?.textContent ?? item.textContent?.trim(),
      }))
      .sort((a, b) => a.y - b.y)
      .map(({ label }) => label);

  const groupAndRender = async (grouper: ChannelGrouper) => {
    grouper.grouping();
    await new Promise((resolve) => requestAnimationFrame(resolve));
  };

  const expected = ['Channels', 'ask┬develop', 'ask└hr', '/┬alert_kintai', '/├bank_pl', '/└general', 'Direct messages'];

  it('moves lone channels to the end of the section and keeps them there', async () => {
    renderSidebar([
      { heading: 'Channels' },
      { id: 'C1', name: 'alert_kintai' },
      { id: 'C2', name: 'ask-develop' },
      { id: 'C3', name: 'ask-hr' },
      { id: 'C4', name: 'bank_pl' },
      { id: 'C5', name: 'general' },
      { heading: 'Direct messages' },
    ]);
    const grouper = new ChannelGrouper(new DomChannelManipulator());

    await groupAndRender(grouper);
    expect(displayedLabels()).toEqual(expected);

    // Running again does not move anything further
    await groupAndRender(grouper);
    expect(displayedLabels()).toEqual(expected);
  });

  it('moves the item again after Slack re-renders its position', async () => {
    renderSidebar([
      { id: 'C1', name: 'alpha' },
      { id: 'C2', name: 'g-1' },
      { id: 'C3', name: 'g-2' },
      { id: 'C4', name: 'omega' },
    ]);
    const grouper = new ChannelGrouper(new DomChannelManipulator());

    await groupAndRender(grouper);
    expect(displayedLabels()).toEqual(['g┬1', 'g└2', '/┬alpha', '/└omega']);

    // Slack writes its own position back
    const alpha = document.querySelectorAll<HTMLElement>('[role=treeitem]')[0];
    alpha.style.transform = 'translateY(0px)';

    await groupAndRender(grouper);
    expect(displayedLabels()).toEqual(['g┬1', 'g└2', '/┬alpha', '/└omega']);
  });
});
