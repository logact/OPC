import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { tasksApi } from '../api/http';
import { theme } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

/**
 * Chat 内的任务卡片（issue #129）：task 模式创建任务后，server 会把带
 * metadata.opcTask.kind = 'reference' 的卡片消息发回发起房间，ChatScreen
 * 据此渲染本组件。标题/描述/状态实时取自 tasks API，点击跳转任务详情页。
 */
export function TaskCard({
  taskId,
  mine = false,
  testID,
}: {
  taskId: string;
  mine?: boolean;
  testID?: string;
}): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
  const taskQuery = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => tasksApi.get(taskId),
  });
  const task = taskQuery.data?.task;

  return (
    <TouchableOpacity
      style={[styles.card, mine ? styles.cardMine : styles.cardOther]}
      testID={testID ?? `task-card-${taskId}`}
      onPress={() => navigation.navigate('TaskDetail', { taskId })}>
      <View style={styles.header}>
        <Text style={styles.kind}>TASK</Text>
        {task ? (
          <Text style={styles.status} testID={`task-card-status-${taskId}`}>
            {task.status.replaceAll('_', ' ')}
          </Text>
        ) : null}
      </View>
      <Text style={styles.title} numberOfLines={2} testID={`task-card-title-${taskId}`}>
        {task?.title ?? 'Loading task…'}
      </Text>
      {task?.description ? (
        <Text style={styles.description} numberOfLines={3}>
          {task.description}
        </Text>
      ) : null}
      <Text style={styles.link}>View task ›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    maxWidth: '88%',
    backgroundColor: theme.colors.panel2,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  cardMine: {
    alignSelf: 'flex-end',
  },
  cardOther: {
    alignSelf: 'flex-start',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  kind: {
    color: theme.colors.accent,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  status: {
    color: theme.colors.accent,
    fontSize: 11,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  title: {
    color: theme.colors.text,
    fontSize: 14.5,
    fontWeight: '700',
    lineHeight: 20,
  },
  description: {
    color: theme.colors.muted,
    fontSize: 12.5,
    lineHeight: 18,
  },
  link: {
    color: theme.colors.accent,
    fontSize: 12,
    fontWeight: '600',
  },
});
