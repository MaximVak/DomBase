export const channelIds = ["company", "managers"] as const;
export type Channel = typeof channelIds[number];
export const channelTitles: Record<Channel, string> = { company: "Company", managers: "Managers" };
export type ChannelPost = {
  id: number; channel: Channel; author: string; title: string | null; body: string; pinnedAt: string | null;
  createdAt: string; readAt: string | null; canManage: boolean;
};
export type ChannelFeed = {
  channel: Channel; channels: Channel[]; canPublish: boolean; emailAvailable: boolean; posts: ChannelPost[]; canLoadOlder: boolean;
};
export type AnnouncementReceipts = { read: number; total: number; people: { accountId: number; name: string; readAt: string | null }[] };
