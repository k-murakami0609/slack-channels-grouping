import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChannelGrouper from '../app/scripts/content/channel-grouper';
import {
  type ChannelItemContext,
  ChannelItemContextGroupType,
  type ChannelManipulator,
} from '../app/scripts/content/channel-manipulators/channel-manipulator';
import { DomChannelManipulator } from '../app/scripts/content/channel-manipulators/dom-channel-manipulator';
import {
  GatheredChannelStore,
  STORAGE_KEY_GATHERED_CHANNELS,
  channelKey,
} from '../app/scripts/content/gathered-channel-store';

class MockChannelManipulator implements ChannelManipulator {
  constructor(private readonly channels: ChannelItemContext[]) {}

  getChannelItemContexts(): ChannelItemContext[] {
    return this.channels;
  }

  persistGroupedChannelItemContexts(): void {}

  updateChannelItems(): void {}
}

const groupWithGathered = (channels: ChannelItemContext[], gathered: string[]) => {
  const grouper = new ChannelGrouper(new MockChannelManipulator(channels), (context) =>
    gathered.includes(channelKey(context.id, context.name)),
  );
  return grouper.grouping() ?? [];
};

const channel = (index: number, id: string, name: string): ChannelItemContext => ({
  index,
  id,
  name,
  channelItemType: 'channel',
});

describe('ChannelGrouper with gathered channels', () => {
  it('moves gathered channels to the end of the section and groups them under "/"', () => {
    const result = groupWithGathered(
      [
        channel(0, 'C1', 'alert_kintai'),
        channel(1, 'C2', 'app_request'),
        channel(2, 'C3', 'ask-develop'),
        channel(3, 'C4', 'ask-hr'),
        channel(4, 'C5', 'bank_pl'),
        channel(5, 'C6', 'general'),
      ],
      ['C1', 'C2', 'C5'],
    );

    expect(result.map(({ index, rawName, prefix, groupType }) => ({ index, rawName, prefix, groupType }))).toEqual([
      { index: 2, rawName: 'ask-develop', prefix: 'ask', groupType: ChannelItemContextGroupType.Parent },
      { index: 3, rawName: 'ask-hr', prefix: 'ask', groupType: ChannelItemContextGroupType.LastChild },
      { index: 5, rawName: 'general', prefix: null, groupType: ChannelItemContextGroupType.Alone },
      { index: 0, rawName: 'alert_kintai', prefix: '/', groupType: ChannelItemContextGroupType.Parent },
      { index: 1, rawName: 'app_request', prefix: '/', groupType: ChannelItemContextGroupType.Child },
      { index: 4, rawName: 'bank_pl', prefix: '/', groupType: ChannelItemContextGroupType.LastChild },
    ]);
  });

  it('keeps gathered channels inside their own section', () => {
    const result = groupWithGathered(
      [
        { index: 0, name: 'Section A', channelItemType: null },
        channel(1, 'C1', 'a-1'),
        channel(2, 'C2', 'b'),
        { index: 3, name: 'Section B', channelItemType: null },
        channel(4, 'C3', 'c'),
        channel(5, 'C4', 'd'),
      ],
      ['C1', 'C3'],
    );

    expect(result.map(({ index }) => index)).toEqual([0, 2, 1, 3, 5, 4]);
    expect(result.filter((context) => context.gathered).map(({ rawName }) => rawName)).toEqual(['a-1', 'c']);
  });

  it('keeps Slack order when nothing is gathered', () => {
    const result = groupWithGathered([channel(0, 'C1', 'a-1'), channel(1, 'C2', 'a-2')], []);

    expect(result.map(({ index, name, gathered }) => ({ index, name, gathered }))).toEqual([
      { index: 0, name: 'a-1', gathered: false },
      { index: 1, name: 'a-2', gathered: false },
    ]);
  });

  it('does not gather direct messages', () => {
    const result = groupWithGathered(
      [
        { index: 0, id: 'D1', name: 'someone', channelItemType: 'im' },
        { index: 1, id: 'D2', name: 'other', channelItemType: 'im' },
      ],
      ['D1'],
    );

    expect(result.map(({ index, gathered }) => ({ index, gathered }))).toEqual([
      { index: 0, gathered: false },
      { index: 1, gathered: false },
    ]);
  });
});

describe('channelKey', () => {
  it('prefers the channel ID', () => {
    expect(channelKey('C1', 'general')).toBe('C1');
    expect(channelKey(null, 'general')).toBe('name:general');
  });
});

describe('GatheredChannelStore', () => {
  let data: Record<string, unknown>;
  let listeners: ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void)[];
  let storage: chrome.storage.StorageArea;

  beforeEach(() => {
    data = {};
    listeners = [];
    storage = {
      get: vi.fn(async (key: string) => ({ [key]: data[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(data, items);
      }),
    } as unknown as chrome.storage.StorageArea;
    vi.stubGlobal('chrome', {
      storage: {
        local: storage,
        onChanged: { addListener: (listener: (typeof listeners)[number]) => listeners.push(listener) },
      },
    });
  });

  it('toggles channels', async () => {
    const store = new GatheredChannelStore(storage);
    await store.load();
    expect(store.has('C1')).toBe(false);

    await store.toggle('C1');
    expect(store.has('C1')).toBe(true);
    expect(data[STORAGE_KEY_GATHERED_CHANNELS]).toEqual(['C1']);

    await store.toggle('C1');
    expect(store.has('C1')).toBe(false);
    expect(data[STORAGE_KEY_GATHERED_CHANNELS]).toEqual([]);
  });

  it('keeps channels saved from another tab', async () => {
    const store = new GatheredChannelStore(storage);
    await store.load();
    data[STORAGE_KEY_GATHERED_CHANNELS] = ['C2'];

    await store.toggle('C1');

    expect(data[STORAGE_KEY_GATHERED_CHANNELS]).toEqual(['C2', 'C1']);
  });

  it('ignores broken values', async () => {
    data[STORAGE_KEY_GATHERED_CHANNELS] = ['C1', 123, ''];
    const store = new GatheredChannelStore(storage);
    await store.load();

    expect(store.has('C1')).toBe(true);
    expect(store.has('')).toBe(false);
  });

  it('follows storage changes and emits change', async () => {
    const store = new GatheredChannelStore(storage);
    await store.load();
    store.watch();
    const onChange = vi.fn();
    store.on('change', onChange);

    listeners.forEach((listener) => listener({ [STORAGE_KEY_GATHERED_CHANNELS]: { newValue: ['C1'] } }, 'sync'));
    expect(onChange).not.toHaveBeenCalled();

    listeners.forEach((listener) => listener({ [STORAGE_KEY_GATHERED_CHANNELS]: { newValue: ['C1'] } }, 'local'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(store.has('C1')).toBe(true);
  });
});

describe('DomChannelManipulator with gathered channels', () => {
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

  it('moves gathered channels and puts them back', async () => {
    renderSidebar([
      { heading: 'Channels' },
      { id: 'C1', name: 'alert_kintai' },
      { id: 'C2', name: 'ask-develop' },
      { id: 'C3', name: 'ask-hr' },
      { id: 'C4', name: 'bank_pl' },
      { id: 'C5', name: 'general' },
      { heading: 'Direct messages' },
    ]);
    const gathered = new Set(['C1', 'C4']);
    const manipulator = new DomChannelManipulator();
    const grouper = new ChannelGrouper(manipulator, (context) => gathered.has(channelKey(context.id, context.name)));

    await groupAndRender(grouper);
    expect(displayedLabels()).toEqual([
      'Channels',
      'ask┬develop',
      'ask└hr',
      'general',
      '/┬alert_kintai',
      '/└bank_pl',
      'Direct messages',
    ]);

    // Running again does not move anything further
    await groupAndRender(grouper);
    expect(displayedLabels()).toEqual([
      'Channels',
      'ask┬develop',
      'ask└hr',
      'general',
      '/┬alert_kintai',
      '/└bank_pl',
      'Direct messages',
    ]);

    gathered.clear();
    await groupAndRender(grouper);
    expect(displayedLabels()).toEqual([
      'Channels',
      'alert_kintai',
      'ask┬develop',
      'ask└hr',
      'bank_pl',
      'general',
      'Direct messages',
    ]);
  });

  it('moves the item again after Slack re-renders its position', async () => {
    renderSidebar([
      { id: 'C1', name: 'alpha' },
      { id: 'C2', name: 'beta' },
    ]);
    const manipulator = new DomChannelManipulator();
    const grouper = new ChannelGrouper(manipulator, (context) => context.id === 'C1');

    await groupAndRender(grouper);
    expect(displayedLabels()).toEqual(['beta', 'alpha']);

    // Slack writes its own position back
    const alpha = document.querySelectorAll<HTMLElement>('[role=treeitem]')[0];
    alpha.style.transform = 'translateY(0px)';

    await groupAndRender(grouper);
    expect(displayedLabels()).toEqual(['beta', 'alpha']);
  });
});

describe('gathering with muted channels', () => {
  it('puts gathered channels above the muted channels at the end of the section', () => {
    const result = groupWithGathered(
      [
        channel(0, 'C1', 'alert_kintai'),
        { ...channel(1, 'C2', 'muted-a'), muted: true },
        channel(2, 'C3', 'general'),
        { ...channel(3, 'C4', 'old-a'), muted: true },
        { ...channel(4, 'C5', 'old-b'), muted: true },
        { index: 5, name: 'Direct messages', channelItemType: null },
      ],
      ['C1'],
    );

    // Muted channels in the middle stay; only the trailing muted run goes below the gathered ones
    expect(result.map(({ index }) => index)).toEqual([1, 2, 0, 3, 4, 5]);
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
