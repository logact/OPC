import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { Message, Participant, Room } from '@opc/api-client';
import type { PresencePayload } from '@logact-pub/opc-protocol';
import { roomsApi, participantsApi } from '../api/http';
import { useMqtt } from '../contexts/MqttContext';
import { useRoom } from '../hooks/useRoom';
import { useAuth } from '../hooks/useAuth';
import { useRoomStore } from '../stores/roomStore';
import { theme } from '../theme';
import { avatarColor } from '../utils/avatar';
import { presenceDisplay, type PresenceDisplayState } from '../utils/presenceDisplay';
import { messageTimestamp, otherMemberIds, readBreakdown } from '../utils/readStatus';

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toTimeString().slice(0, 5);
}

// Trailing "@word" at the end of the input opens the mention box (prototype logic).
const MENTION_TAIL = /@\w*$/;

// 已读回执上报的 trailing 防抖间隔（issue #108）：每个房间至多每 2s 一次。
const READ_RECEIPT_DEBOUNCE_MS = 2000;

export function ChatScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const route = useRoute();
  const { roomId, roomName } = route.params as { roomId: string; roomName: string };
  const { participantId } = useAuth();
  const { client } = useMqtt();
  const { messages, isLoadingMessages, enterRoom, leaveRoom, sendText } = useRoom();

  const [text, setText] = useState('');
  const [room, setRoom] = useState<Room | null>(null);
  const [members, setMembers] = useState<Record<string, Participant>>({});
  const [mentionOpen, setMentionOpen] = useState(false);
  // Live presence payloads keyed by participant id (issue #83 agent status).
  const [livePresence, setLivePresence] = useState<Record<string, PresencePayload>>({});
  // 当前房间全部成员的已读游标（issue #108），由 roomStore 维护。
  const readCursors = useRoomStore((s) => s.readCursors[roomId]);
  const inputRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    return client?.subscribePresence((id, presence) => {
      setLivePresence((prev) => {
        const current = prev[id];
        return current?.online === presence.online && current?.status === presence.status
          ? prev
          : { ...prev, [id]: presence };
      });
    });
  }, [client]);

  useEffect(() => {
    enterRoom(roomId);
    return () => {
      leaveRoom();
    };
  }, [roomId, enterRoom, leaveRoom]);

  // 已读回执上报（issue #108）：只在聊天页打开时上报——进房后（history 加载
  // 完成）以最新消息的 server 时间戳上报一次，之后每收到新消息再上报；
  // trailing 防抖，每个房间至多每 2s 一次。房间列表与后台不上报。
  const receiptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPublishedCursorRef = useRef<string | null>(null);

  useEffect(() => {
    lastPublishedCursorRef.current = null;
    return () => {
      if (receiptTimerRef.current) {
        clearTimeout(receiptTimerRef.current);
        receiptTimerRef.current = null;
      }
    };
  }, [roomId]);

  useEffect(() => {
    if (!client || !participantId) return;
    let latest: string | null = null;
    for (const message of messages) {
      const ts = messageTimestamp(message);
      if (ts && (latest === null || ts > latest)) latest = ts;
    }
    if (!latest) return;
    const last = lastPublishedCursorRef.current;
    if (last !== null && latest <= last) return;
    if (receiptTimerRef.current) clearTimeout(receiptTimerRef.current);
    const cursor = latest;
    receiptTimerRef.current = setTimeout(() => {
      receiptTimerRef.current = null;
      lastPublishedCursorRef.current = cursor;
      try {
        client.publishReadReceipt(roomId, participantId, cursor);
      } catch {
        // 未连接时丢弃本次上报；下一条消息或下次进房会补报
      }
    }, READ_RECEIPT_DEBOUNCE_MS);
  }, [client, participantId, roomId, messages]);

  // Load the room (member count) and its participants (names + agent kind).
  useEffect(() => {
    let cancelled = false;
    setRoom(null);
    setMembers({});
    roomsApi
      .get(roomId)
      .then(async ({ room: loaded }) => {
        if (cancelled) return;
        setRoom(loaded);
        const entries = await Promise.all(
          loaded.participantIds.map(async (id) => {
            try {
              const { participant } = await participantsApi.get(id);
              return [id, participant] as const;
            } catch {
              return null;
            }
          }),
        );
        if (cancelled) return;
        const map: Record<string, Participant> = {};
        for (const entry of entries) {
          if (entry) map[entry[0]] = entry[1];
        }
        setMembers(map);
      })
      .catch(() => {
        // Room lookup failed: keep the plain route-param title, no mention data.
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  const isGroup = room?.metadata?.type === 'group';
  const title =
    isGroup && room ? `${roomName} (${room.participantIds.length})` : roomName;

  // Agent participants of this room = mention box entries.
  const agents = useMemo(() => {
    if (!room) return [];
    return room.participantIds
      .map((id) => members[id])
      .filter(
        (p): p is Participant =>
          p !== undefined && p.kind === 'agent' && p.id !== participantId,
      );
  }, [room, members, participantId]);

  // One-line agent activity hint below the header, driven by real runtime
  // status via presence (issue #83 — not the simulated typing indicator that
  // issue #79 removed). Live payloads override the fetched presence; at most
  // one line, for the first agent currently working/blocking/error.
  const agentActivity = useMemo(() => {
    const ACTIVITY_TEXT: Partial<Record<PresenceDisplayState, (name: string) => string>> = {
      working: (name) => `${name} working…`,
      blocking: (name) => `${name} waiting for input`,
      error: (name) => `${name} error`,
    };
    for (const agent of agents) {
      const live = livePresence[agent.id];
      const display = presenceDisplay(
        live ? { online: live.online, status: live.status } : agent.presence,
      );
      const textFor = ACTIVITY_TEXT[display.state];
      if (textFor) {
        return { text: textFor(agent.name ?? agent.id), color: display.color };
      }
    }
    return null;
  }, [agents, livePresence]);

  const handleChangeText = useCallback((value: string) => {
    setText(value);
    setMentionOpen(value.endsWith('@') || MENTION_TAIL.test(value));
  }, []);

  const handleAtPress = useCallback(() => {
    setText((prev) => `${prev}@`);
    setMentionOpen(true);
    inputRef.current?.focus();
  }, []);

  const handlePickMention = useCallback((name: string) => {
    setText((prev) => `${prev.replace(MENTION_TAIL, '')}@${name} `);
    setMentionOpen(false);
  }, []);

  const handleSend = useCallback(() => {
    const value = text.trim();
    if (!value) return;
    sendText(roomId, value);
    setText('');
    setMentionOpen(false);
  }, [text, roomId, sendText]);

  const renderMessage = ({ item }: { item: Message }) => {
    if (item.content.type === 'system') {
      return (
        <View style={styles.sys} testID={`msg-sys-${item.id}`}>
          <Text style={styles.sysText}>{item.content.body}</Text>
        </View>
      );
    }

    const time = formatTime(messageTimestamp(item) ?? '');

    if (item.from === participantId) {
      // 已读状态（issue #108）：至少一个其他成员的游标 >= 消息时间戳即已读；
      // 群聊额外展示 X/Y 与谁已读/谁未读。房间数据未加载时不显示指示。
      let readStatus: React.JSX.Element | null = null;
      if (room && participantId) {
        const others = otherMemberIds(room.participantIds, participantId);
        const ts = messageTimestamp(item);
        const breakdown =
          ts !== undefined
            ? readBreakdown(ts, others, readCursors ?? {})
            : { read: [], unread: others };
        const nameOf = (id: string) => members[id]?.name ?? id;
        const allRead = breakdown.unread.length === 0 && others.length > 0;
        const statusText = isGroup
          ? `${allRead ? '✓✓' : '✓'} 已读 ${breakdown.read.length}/${others.length}`
          : allRead
            ? '✓✓ 已读'
            : '✓ 未读';
        readStatus = (
          <>
            <Text
              style={[styles.metaText, allRead && styles.metaRead]}
              testID={`msg-read-status-${item.id}`}>
              {statusText}
            </Text>
            {isGroup && others.length > 0 ? (
              <Text style={styles.metaText} testID={`msg-read-detail-${item.id}`}>
                {`已读: ${breakdown.read.map(nameOf).join('、') || '—'} · 未读: ${
                  breakdown.unread.map(nameOf).join('、') || '—'
                }`}
              </Text>
            ) : null}
          </>
        );
      }
      return (
        <View style={[styles.msg, styles.msgMe]} testID={`msg-item-${item.id}`}>
          <View style={styles.msgBody}>
            <View
              style={[styles.bubble, styles.bubbleMe]}
              testID={`msg-bubble-me-${item.id}`}>
              <Text style={styles.bubbleText}>{item.content.body}</Text>
            </View>
            <View
              style={[styles.meta, styles.metaMe]}
              testID={`msg-meta-${item.id}`}>
              <Text style={styles.metaText}>{time}</Text>
              {readStatus}
            </View>
          </View>
        </View>
      );
    }

    const sender = members[item.from];
    const senderName = sender?.name ?? item.from;
    const isAgent = sender?.kind === 'agent';

    return (
      <View style={styles.msg} testID={`msg-item-${item.id}`}>
        <View
          style={[styles.msgAvatar, { backgroundColor: avatarColor(item.from) }]}>
          <Text style={styles.msgAvatarText}>
            {senderName.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.msgBody}>
          <View style={styles.who} testID={`msg-who-${item.from}`}>
            <Text style={styles.whoText}>{senderName}</Text>
            {isAgent ? (
              <View style={styles.tagAgent} testID={`msg-tag-agent-${item.from}`}>
                <Text style={styles.tagAgentText}>AGENT</Text>
              </View>
            ) : null}
          </View>
          <View
            style={[styles.bubble, styles.bubbleOther]}
            testID={`msg-bubble-other-${item.id}`}>
            <Text style={styles.bubbleText}>{item.content.body}</Text>
          </View>
          <View style={styles.meta} testID={`msg-meta-${item.id}`}>
            <Text style={styles.metaText}>{time}</Text>
            {/* Endpoint chip omitted: the protocol has no endpoint/protocol
                data for participants, so there is nothing real to show. */}
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="screen-room">
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}>
        <View style={styles.navbar}>
          <TouchableOpacity
            testID="room-back"
            onPress={() => navigation.goBack()}
            hitSlop={8}>
            <Text style={styles.navBack}>‹ Chats</Text>
          </TouchableOpacity>
          <Text style={styles.navTitle} numberOfLines={1} testID="room-title">
            {title}
          </Text>
          <TouchableOpacity
            testID="room-info-btn"
            onPress={() => navigation.navigate('RoomInfo', { roomId })}
            hitSlop={8}>
            <Text style={styles.navAction}>⋯</Text>
          </TouchableOpacity>
        </View>

        {agentActivity ? (
          <View style={styles.activityBar} testID="agent-activity-indicator">
            <Text style={[styles.activityText, { color: agentActivity.color }]}>
              {agentActivity.text}
            </Text>
          </View>
        ) : null}

        <View style={styles.body}>
          {isLoadingMessages ? (
            <ActivityIndicator
              style={styles.loader}
              color={theme.colors.accent}
            />
          ) : (
            <FlatList
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={renderMessage}
              contentContainerStyle={styles.msgList}
              testID="msg-list"
            />
          )}

          {mentionOpen ? (
            <View style={styles.mentionShadow} testID="mention-box">
              <View style={styles.mentionBox}>
                {agents.length === 0 ? (
                  <View style={styles.mentionItem}>
                    <Text style={styles.mentionEmpty}>No agents in this chat</Text>
                  </View>
                ) : (
                  agents.map((agent, index) => {
                    const name = agent.name ?? agent.id;
                    return (
                      <TouchableOpacity
                        key={agent.id}
                        testID={`mention-item-${agent.id}`}
                        style={[
                          styles.mentionItem,
                          index < agents.length - 1 && styles.mentionItemBorder,
                        ]}
                        onPress={() => handlePickMention(name)}>
                        <View
                          style={[
                            styles.mentionAvatar,
                            { backgroundColor: avatarColor(agent.id) },
                          ]}>
                          <Text style={styles.mentionAvatarText}>
                            {name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <Text style={styles.mentionName}>@{name}</Text>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            </View>
          ) : null}
        </View>

        <View style={[styles.inputBar, { paddingBottom: 10 + insets.bottom }]}>
          <TouchableOpacity
            style={styles.atPill}
            testID="room-at-btn"
            onPress={handleAtPress}
            hitSlop={4}>
            <Text style={styles.atPillText}>@</Text>
          </TouchableOpacity>
          <TextInput
            ref={inputRef}
            style={styles.input}
            testID="room-input"
            value={text}
            onChangeText={handleChangeText}
            placeholder="Message…  (@ to call an agent)"
            placeholderTextColor={theme.colors.muted}
            returnKeyType="send"
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
            testID="room-send-btn"
            onPress={handleSend}
            disabled={!text.trim()}>
            <Text style={styles.sendBtnText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  flex: {
    flex: 1,
  },
  navbar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.line,
    backgroundColor: theme.colors.panel,
  },
  navBack: {
    color: theme.colors.accent,
    fontSize: 15,
  },
  navTitle: {
    flex: 1,
    textAlign: 'center',
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: '700',
    marginHorizontal: 8,
  },
  navAction: {
    color: theme.colors.accent,
    fontSize: 22,
  },
  body: {
    flex: 1,
  },
  activityBar: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.line,
    backgroundColor: theme.colors.panel,
  },
  activityText: {
    fontSize: 12,
    fontWeight: '600',
  },
  loader: {
    marginTop: 24,
  },
  msgList: {
    paddingHorizontal: 12,
    paddingVertical: 14,
    gap: 14,
  },
  msg: {
    flexDirection: 'row',
    gap: 8,
    maxWidth: '88%',
  },
  msgMe: {
    alignSelf: 'flex-end',
    flexDirection: 'row-reverse',
  },
  msgAvatar: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  msgAvatarText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  msgBody: {
    minWidth: 0,
    flexShrink: 1,
  },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
    marginLeft: 2,
  },
  whoText: {
    fontSize: 11.5,
    color: theme.colors.muted,
  },
  tagAgent: {
    backgroundColor: theme.colors.agent,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
  },
  tagAgentText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: theme.colors.bg,
  },
  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  bubbleOther: {
    backgroundColor: theme.colors.bubbleOther,
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 14,
    borderBottomRightRadius: 14,
    borderBottomLeftRadius: 14,
  },
  bubbleMe: {
    backgroundColor: theme.colors.bubbleMe,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 14,
    borderBottomLeftRadius: 14,
  },
  bubbleText: {
    color: theme.colors.text,
    fontSize: 14.5,
    lineHeight: 21,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  metaMe: {
    justifyContent: 'flex-end',
  },
  metaText: {
    fontSize: 10,
    color: theme.colors.muted,
  },
  metaRead: {
    color: theme.colors.accent,
  },
  sys: {
    alignSelf: 'center',
    backgroundColor: theme.colors.panel2,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  sysText: {
    fontSize: 11.5,
    color: theme.colors.muted,
  },
  mentionShadow: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
    backgroundColor: theme.colors.panel2,
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: 12,
    // Elevated panel look from the prototype (0 -8px 30px rgba(0,0,0,.4)).
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.4,
    shadowRadius: 15,
    elevation: 12,
  },
  mentionBox: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  mentionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  mentionItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.line,
  },
  mentionAvatar: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mentionAvatarText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  mentionName: {
    color: theme.colors.text,
    fontSize: 13.5,
    fontWeight: '600',
  },
  mentionEmpty: {
    color: theme.colors.muted,
    fontSize: 13.5,
    fontWeight: '600',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.line,
    backgroundColor: theme.colors.panel,
  },
  atPill: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.colors.panel2,
    borderWidth: 1,
    borderColor: theme.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  atPillText: {
    color: theme.colors.accent,
    fontSize: 17,
  },
  input: {
    flex: 1,
    backgroundColor: theme.colors.panel2,
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    color: theme.colors.text,
    fontSize: 14,
  },
  sendBtn: {
    backgroundColor: theme.colors.accent,
    borderRadius: 18,
    paddingHorizontal: 16,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
  sendBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});
