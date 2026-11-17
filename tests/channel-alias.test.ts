import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChannelAliasStore,
  STORAGE_KEY_CHANNEL_ALIASES,
  channelAliasKey,
  normalizeAlias,
} from '../app/scripts/content/channel-alias-store';
import ChannelGrouper from '../app/scripts/content/channel-grouper';
import {
  type ChannelItemContext,
  ChannelItemContextGroupType,
  type ChannelManipulator,
  type GroupedChannelItemContext,
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

const groupWithAliases = (channels: ChannelItemContext[], aliases: Record<string, string>) => {
  const grouper = new ChannelGrouper(
    new MockChannelManipulator(channels),
    (context) => aliases[channelAliasKey(context.id, context.name)] ?? null,
  );
  return grouper.grouping() ?? [];
};

describe('ChannelGrouper with aliases', () => {
  it('groups by alias and keeps the raw name', () => {
    const result = groupWithAliases(
      [
        { index: 0, id: 'C1', name: 'proj-a', channelItemType: 'channel' },
        { index: 1, id: 'C2', name: 'random-stuff', channelItemType: 'channel' },
        { index: 2, id: 'C3', name: 'zzz', channelItemType: 'channel' },
      ],
      { C2: 'proj-b' },
    );

    expect(
      result.map(({ name, rawName, alias, prefix, groupType }) => ({ name, rawName, alias, prefix, groupType })),
    ).toEqual([
      { name: 'proj-a', rawName: 'proj-a', alias: null, prefix: 'proj', groupType: ChannelItemContextGroupType.Parent },
      {
        name: 'proj-b',
        rawName: 'random-stuff',
        alias: 'proj-b',
        prefix: 'proj',
        groupType: ChannelItemContextGroupType.LastChild,
      },
      { name: 'zzz', rawName: 'zzz', alias: null, prefix: null, groupType: ChannelItemContextGroupType.Alone },
    ]);
  });

  it('takes a channel out of its group when the alias has another prefix', () => {
    const result = groupWithAliases(
      [
        { index: 0, id: 'C1', name: 'proj-a', channelItemType: 'channel' },
        { index: 1, id: 'C2', name: 'proj-b', channelItemType: 'channel' },
      ],
      { C2: 'Bチーム' },
    );

    expect(result.map(({ prefix, groupType }) => ({ prefix, groupType }))).toEqual([
      { prefix: 'proj', groupType: ChannelItemContextGroupType.Alone },
      { prefix: null, groupType: ChannelItemContextGroupType.Alone },
    ]);
  });

  it('falls back to the channel name as the key when the ID is unknown', () => {
    const result = groupWithAliases([{ index: 0, id: null, name: 'general', channelItemType: 'channel' }], {
      'name:general': '全体',
    });

    expect(result[0]).toMatchObject({ name: '全体', rawName: 'general', alias: '全体' });
  });

  it('ignores aliases for direct messages', () => {
    const result = groupWithAliases([{ index: 0, id: 'D1', name: 'someone', channelItemType: 'im' }], {
      D1: 'alias',
    });

    expect(result[0]).toMatchObject({ name: 'someone', alias: null });
  });

  it('makes the aliased channel the root of a group', () => {
    const result = groupWithAliases(
      [
        { index: 0, id: 'C1', name: 'misc', channelItemType: 'channel' },
        { index: 1, id: 'C2', name: 'proj-a', channelItemType: 'channel' },
      ],
      { C1: 'proj' },
    );

    expect(result.map(({ name, prefix, groupType }) => ({ name, prefix, groupType }))).toEqual([
      { name: 'proj-/', prefix: 'proj', groupType: ChannelItemContextGroupType.Parent },
      { name: 'proj-a', prefix: 'proj', groupType: ChannelItemContextGroupType.LastChild },
    ]);
  });
});

describe('alias helpers', () => {
  it('normalizes input', () => {
    expect(normalizeAlias('  foo  ')).toBe('foo');
    expect(normalizeAlias('   ')).toBeNull();
  });

  it('builds keys', () => {
    expect(channelAliasKey('C1', 'general')).toBe('C1');
    expect(channelAliasKey(null, 'general')).toBe('name:general');
  });
});

describe('ChannelAliasStore', () => {
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

  it('sets, changes and removes aliases', async () => {
    const store = new ChannelAliasStore(storage);
    await store.load();
    expect(store.get('C1')).toBeNull();

    await store.set('C1', 'foo');
    expect(store.get('C1')).toBe('foo');
    expect(data[STORAGE_KEY_CHANNEL_ALIASES]).toEqual({ C1: 'foo' });

    await store.set('C1', 'bar');
    expect(data[STORAGE_KEY_CHANNEL_ALIASES]).toEqual({ C1: 'bar' });

    await store.set('C1', null);
    expect(store.get('C1')).toBeNull();
    expect(data[STORAGE_KEY_CHANNEL_ALIASES]).toEqual({});
  });

  it('keeps aliases saved from another tab', async () => {
    const store = new ChannelAliasStore(storage);
    await store.load();
    data[STORAGE_KEY_CHANNEL_ALIASES] = { C2: 'other' };

    await store.set('C1', 'foo');

    expect(data[STORAGE_KEY_CHANNEL_ALIASES]).toEqual({ C1: 'foo', C2: 'other' });
  });

  it('loads saved aliases and ignores broken values', async () => {
    data[STORAGE_KEY_CHANNEL_ALIASES] = { C1: 'foo', C2: 123, C3: '' };
    const store = new ChannelAliasStore(storage);
    await store.load();

    expect(store.get('C1')).toBe('foo');
    expect(store.get('C2')).toBeNull();
    expect(store.get('C3')).toBeNull();
  });

  it('follows storage changes and emits change', async () => {
    const store = new ChannelAliasStore(storage);
    await store.load();
    store.watch();
    const onChange = vi.fn();
    store.on('change', onChange);

    listeners.forEach((listener) => listener({ [STORAGE_KEY_CHANNEL_ALIASES]: { newValue: { C1: 'foo' } } }, 'sync'));
    expect(onChange).not.toHaveBeenCalled();

    listeners.forEach((listener) => listener({ [STORAGE_KEY_CHANNEL_ALIASES]: { newValue: { C1: 'foo' } } }, 'local'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(store.get('C1')).toBe('foo');
  });
});

describe('DomChannelManipulator with aliases', () => {
  const renderSidebar = (channels: { id: string; name: string }[]) => {
    document.body.innerHTML = `
      <div class="p-channel_sidebar__static_list">
        ${channels
          .map(
            ({ id, name }) => `
          <div role="treeitem">
            <div class="p-channel_sidebar__channel" data-qa-channel-sidebar-channel-type="channel" data-qa-channel-sidebar-channel-id="${id}">
              <span class="p-channel_sidebar__name">${name}</span>
            </div>
          </div>`,
          )
          .join('')}
      </div>`;
  };

  const nameTexts = () =>
    Array.from(document.querySelectorAll('.p-channel_sidebar__name')).map((element) => element.textContent);

  const groupAndRender = async (grouper: ChannelGrouper) => {
    grouper.grouping();
    await new Promise((resolve) => requestAnimationFrame(resolve));
  };

  it('displays aliases and restores the raw name when the alias is removed', async () => {
    renderSidebar([
      { id: 'C1', name: 'general' },
      { id: 'C2', name: 'proj-a' },
      { id: 'C3', name: 'proj-b' },
    ]);
    const aliases = new Map<string, string>([
      ['C1', '全体'],
      ['C3', 'proj-ビー'],
    ]);
    const manipulator = new DomChannelManipulator();
    const grouper = new ChannelGrouper(
      manipulator,
      (context) => aliases.get(channelAliasKey(context.id, context.name)) ?? null,
    );

    await groupAndRender(grouper);
    expect(nameTexts()).toEqual(['全体', 'proj┬a', 'proj└ビー']);

    // Raw names are read back even while aliases are displayed
    expect(manipulator.getChannelItemContexts().map((context) => context.name)).toEqual([
      'general',
      'proj-a',
      'proj-b',
    ]);

    aliases.set('C1', '全体連絡');
    aliases.delete('C3');
    await groupAndRender(grouper);
    expect(nameTexts()).toEqual(['全体連絡', 'proj┬a', 'proj└b']);

    aliases.delete('C1');
    await groupAndRender(grouper);
    expect(nameTexts()).toEqual(['general', 'proj┬a', 'proj└b']);
  });
});
